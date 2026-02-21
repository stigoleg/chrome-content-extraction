import { applyContentPolicies } from "./processing.js";
import { buildCaptureRecord, buildFileName, validateCaptureRecord } from "./schema.js";
import { SaveOperationQueue, createAbortErrorForQueue } from "./save-queue.js";
import { getLastCaptureStatus, getSettings, setLastCaptureStatus } from "./settings.js";
import { buildJsonChunksForRecord, saveRecordToSqlite } from "./sqlite.js";
import { assertAllowedYouTubeFetchUrl } from "./url-guards.js";
import {
  ensureReadWritePermission,
  getSavedDirectoryHandle,
  writeJsonToDirectory
} from "./storage.js";

const MENU_SAVE_SELECTION = "save-selection";
const MENU_SAVE_WITH_COMMENT = "save-with-comment";
const MENU_ADD_HIGHLIGHT = "add-highlight";
const MENU_ADD_NOTE = "add-note";
const MENU_SAVE_YOUTUBE_TRANSCRIPT = "save-youtube-transcript";
const MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT = "save-youtube-transcript-with-comment";
const COMMAND_SAVE_SELECTION = "COMMAND_SAVE_SELECTION";
const COMMAND_SAVE_SELECTION_WITH_COMMENT = "COMMAND_SAVE_SELECTION_WITH_COMMENT";
const INTERNAL_SAVE_SELECTION_WITH_HIGHLIGHT = "INTERNAL_SAVE_SELECTION_WITH_HIGHLIGHT";

const commentRequests = new Map();
const pendingAnnotationsByTab = new Map();
const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen.html");
const START_NOTIFICATION_ID = "capture-start";
const ERROR_NOTIFICATION_ID = "capture-error";
const JSON_OUTPUT_ROOT_DIR = "json";
const CAPTURE_QUEUE_TIMEOUT_MS = 120000;

const captureQueue = new SaveOperationQueue({
  defaultTimeoutMs: CAPTURE_QUEUE_TIMEOUT_MS,
  logger: console
});
const captureAbortControllersByTab = new Map();

function throwIfAborted(signal, fallbackMessage = "Capture cancelled") {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  const error = new Error(reason ? String(reason) : fallbackMessage);
  error.name = "AbortError";
  throw error;
}

function registerCaptureAbortController(tabId, controller) {
  if (!Number.isInteger(tabId) || !controller) {
    return;
  }
  const existing = captureAbortControllersByTab.get(tabId);
  if (existing) {
    existing.add(controller);
    return;
  }
  captureAbortControllersByTab.set(tabId, new Set([controller]));
}

function unregisterCaptureAbortController(tabId, controller) {
  if (!Number.isInteger(tabId) || !controller) {
    return;
  }
  const existing = captureAbortControllersByTab.get(tabId);
  if (!existing) {
    return;
  }
  existing.delete(controller);
  if (existing.size === 0) {
    captureAbortControllersByTab.delete(tabId);
  }
}

function cancelCaptureQueueForTab(tabId, reason = "Capture cancelled because the tab changed.") {
  if (!Number.isInteger(tabId)) {
    return;
  }
  const existing = captureAbortControllersByTab.get(tabId);
  if (!existing || existing.size === 0) {
    return;
  }
  for (const controller of existing) {
    if (!controller.signal.aborted) {
      controller.abort(createAbortErrorForQueue(reason));
    }
  }
  existing.clear();
  captureAbortControllersByTab.delete(tabId);
}

function queueCaptureAction(kind, tabId, selectionOverride = "") {
  const controller = new AbortController();
  registerCaptureAbortController(tabId, controller);

  return captureQueue
    .enqueue({
      label: `capture:${kind}:${tabId}`,
      timeoutMs: CAPTURE_QUEUE_TIMEOUT_MS,
      signal: controller.signal,
      task: ({ signal }) => runAction(kind, tabId, selectionOverride, { signal })
    })
    .finally(() => {
      unregisterCaptureAbortController(tabId, controller);
    });
}

async function extractPdfFromModule(url, options = {}) {
  const module = await import("./pdf.js");
  if (!module?.extractPdfFromUrl) {
    throw new Error("PDF extractor module unavailable");
  }
  return module.extractPdfFromUrl(url, options);
}

async function createMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_SAVE_SELECTION,
    title: "Save content",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: MENU_SAVE_WITH_COMMENT,
    title: "Save with note",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: MENU_ADD_HIGHLIGHT,
    title: "Add highlight",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: MENU_ADD_NOTE,
    title: "Add highlight and note",
    contexts: ["all"]
  });

  chrome.contextMenus.create({
    id: MENU_SAVE_YOUTUBE_TRANSCRIPT,
    title: "Save YouTube transcript",
    contexts: ["all"],
    visible: false
  });

  chrome.contextMenus.create({
    id: MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT,
    title: "Save transcript with note",
    contexts: ["all"],
    visible: false
  });
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0] || null);
}

function isYouTubeUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();

    if (hostname === "youtu.be") {
      const shortId = url.pathname.split("/").filter(Boolean)[0] || "";
      return Boolean(shortId);
    }

    if (!(hostname === "youtube.com" || hostname.endsWith(".youtube.com"))) {
      return false;
    }

    if (url.pathname === "/watch") {
      return Boolean(url.searchParams.get("v"));
    }

    if (url.pathname.startsWith("/shorts/")) {
      return Boolean(url.pathname.split("/")[2]);
    }

    if (url.pathname.startsWith("/live/")) {
      return Boolean(url.pathname.split("/")[2]);
    }

    if (url.pathname.startsWith("/embed/")) {
      return Boolean(url.pathname.split("/")[2]);
    }

    return false;
  } catch (_error) {
    return false;
  }
}

async function setBadge(tabId, text, color) {
  if (!tabId) {
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });

  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  }, 1800);
}

async function captureFromTab(tabId, messageType, options = {}) {
  if (!tabId) {
    throw new Error("No active tab");
  }

  try {
    if (typeof options.frameId === "number") {
      return await chrome.tabs.sendMessage(tabId, { type: messageType }, { frameId: options.frameId });
    }
    return await chrome.tabs.sendMessage(tabId, { type: messageType });
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "No content script available",
      missingReceiver: true
    };
  }
}

async function captureYouTubeTranscriptFromMainWorld(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalizeText = (value) =>
          String(value || "")
            .replace(/\s+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        const normalizeTimestamp = (value) => {
          const normalized = String(value || "").replace(/\s+/g, " ").trim();
          return normalized || null;
        };
        const segmentKey = (segment) => `${segment.timestamp || ""}\u241f${segment.text}`;
        const collapseRepeatedSequence = (segments) => {
          if (!Array.isArray(segments) || segments.length < 2) {
            return Array.isArray(segments) ? segments : [];
          }
          const keys = segments.map(segmentKey);
          const length = keys.length;
          const repeats = [2, 3, 4];
          for (const repeat of repeats) {
            if (length % repeat !== 0) {
              continue;
            }
            const chunkLength = length / repeat;
            let repeated = true;
            for (let i = chunkLength; i < length; i += 1) {
              if (keys[i] !== keys[i % chunkLength]) {
                repeated = false;
                break;
              }
            }
            if (repeated) {
              return segments.slice(0, chunkLength);
            }
          }
          return segments;
        };
        const normalizeSegments = (segments) => {
          if (!Array.isArray(segments) || segments.length === 0) {
            return [];
          }

          const normalized = segments
            .map((segment) => {
              const text = normalizeText(segment?.text || "");
              if (!text) {
                return null;
              }
              return {
                timestamp: normalizeTimestamp(segment?.timestamp),
                text
              };
            })
            .filter(Boolean);

          const adjacentDeduped = [];
          let previousKey = null;
          for (const segment of normalized) {
            const key = segmentKey(segment);
            if (key === previousKey) {
              continue;
            }
            adjacentDeduped.push(segment);
            previousKey = key;
          }

          return collapseRepeatedSequence(adjacentDeduped);
        };
        const getTranscriptRows = () => {
          const panelId = "engagement-panel-searchable-transcript";
          const scopedPanels = Array.from(
            document.querySelectorAll(
              `ytd-engagement-panel-section-list-renderer[target-id="${panelId}"], ` +
                `ytd-engagement-panel-section-list-renderer[panel-identifier="${panelId}"]`
            )
          );
          const scopedRows = scopedPanels.flatMap((panel) =>
            Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer"))
          );
          if (scopedRows.length > 0) {
            return scopedRows;
          }
          return Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
        };
        const readSegments = () =>
          normalizeSegments(
            getTranscriptRows()
              .map((row) => {
                const timestamp =
                  row.querySelector(".segment-timestamp")?.textContent?.trim() ||
                  row.querySelector("#segment-timestamp")?.textContent?.trim() ||
                  row.querySelector("yt-formatted-string.segment-timestamp")?.textContent?.trim() ||
                  null;

                const text =
                  row.querySelector(".segment-text")?.textContent?.trim() ||
                  row.querySelector("#segment-text")?.textContent?.trim() ||
                  row.querySelector("yt-formatted-string.segment-text")?.textContent?.trim() ||
                  null;

                if (!text) {
                  return null;
                }
                return { timestamp, text };
              })
              .filter(Boolean)
          );
        const waitForRows = async (maxAttempts = 24, delayMs = 250) => {
          for (let i = 0; i < maxAttempts; i += 1) {
            if (readSegments().length > 0) {
              return true;
            }
            await sleep(delayMs);
          }
          return false;
        };

        let opened = false;
        let segments = readSegments();
        if (segments.length === 0) {
          const openCommand = {
            changeEngagementPanelVisibilityAction: {
              targetId: "engagement-panel-searchable-transcript",
              visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"
            }
          };
          const hosts = [
            document.querySelector("ytd-watch-flexy"),
            document.querySelector("ytd-app"),
            document.querySelector("ytd-page-manager")
          ];
          for (const host of hosts) {
            const anyHost = /** @type {any} */ (host);
            if (!anyHost) {
              continue;
            }
            try {
              if (typeof anyHost.resolveCommand === "function") {
                anyHost.resolveCommand(openCommand);
                opened = true;
                break;
              }
              if (typeof anyHost.handleCommand === "function") {
                anyHost.handleCommand(openCommand);
                opened = true;
                break;
              }
            } catch (_error) {
              continue;
            }
          }
          if (opened) {
            await waitForRows();
            segments = readSegments();
          }
        }

        if (segments.length === 0) {
          const candidates = Array.from(
            document.querySelectorAll(
              "button, tp-yt-paper-item, ytd-button-renderer, ytd-menu-service-item-renderer"
            )
          );
          const transcriptButton = candidates.find((el) =>
            /(transcript|transkrips|transkrip|caption|subtit)/i.test(el.textContent || "")
          );
          if (transcriptButton) {
            /** @type {HTMLElement} */ (transcriptButton).click();
            opened = true;
            await waitForRows();
            segments = readSegments();
          }
        }

        return {
          ok: true,
          source: "main_world_dom",
          opened,
          segmentCount: segments.length,
          transcriptText: segments.map((segment) => normalizeText(segment.text)).join("\n"),
          segments
        };
      }
    });

    return Array.isArray(results) ? results[0]?.result || null : null;
  } catch (_error) {
    return null;
  }
}

async function readSelectionFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => window.getSelection()?.toString() || ""
    });
    if (!Array.isArray(results)) {
      return "";
    }
    for (const item of results) {
      const value = item?.result;
      if (value && String(value).trim()) {
        return String(value).trim();
      }
    }
  } catch (_error) {
    return "";
  }
  return "";
}

async function readClipboardTextFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async () => {
        try {
          if (!navigator.clipboard?.readText) {
            return "";
          }
          const text = await navigator.clipboard.readText();
          return String(text || "").trim();
        } catch (_error) {
          return "";
        }
        return "";
      }
    });
    if (!Array.isArray(results)) {
      return "";
    }
    for (const item of results) {
      const value = item?.result;
      if (value && String(value).trim()) {
        return String(value).trim();
      }
    }
  } catch (_error) {
    return "";
  }
  return "";
}

async function resolveSelection(tabId, selectionOverride = "", options = {}) {
  const trimmedOverride = selectionOverride.trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }

  const allowClipboardRead = options.allowClipboardRead === true;
  const allowClipboardCopy = options.allowClipboardCopy !== false;

  const fromPage = await readSelectionFromPage(tabId);
  if (fromPage) {
    return fromPage;
  }

  if (allowClipboardRead) {
    const fromClipboard = await readClipboardTextFromPage(tabId);
    if (fromClipboard) {
      return fromClipboard;
    }
  }

  if (allowClipboardCopy) {
    const copied = await copySelectionFromPage(tabId);
    if (copied) {
      return await readClipboardTextViaOffscreen();
    }
  }

  return "";
}

function addPendingAnnotation(tabId, annotation) {
  const existing = pendingAnnotationsByTab.get(tabId) || [];
  const entry = {
    id:
      annotation?.id ||
      (globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`),
    selectedText: annotation?.selectedText ?? "",
    comment: annotation?.comment ?? null,
    createdAt: annotation?.createdAt || new Date().toISOString()
  };
  existing.push(entry);
  pendingAnnotationsByTab.set(tabId, existing);
  return {
    count: existing.length,
    annotation: entry
  };
}

function removePendingAnnotation(tabId, annotationId) {
  const existing = pendingAnnotationsByTab.get(tabId) || [];
  if (!annotationId) {
    return {
      count: existing.length,
      removed: false
    };
  }

  const next = existing.filter((annotation) => annotation?.id !== annotationId);
  const removed = next.length !== existing.length;
  if (next.length > 0) {
    pendingAnnotationsByTab.set(tabId, next);
  } else {
    pendingAnnotationsByTab.delete(tabId);
  }

  return {
    count: next.length,
    removed
  };
}

function clearPendingAnnotations(tabId) {
  pendingAnnotationsByTab.delete(tabId);
}

function getPendingAnnotationsSnapshot(tabId) {
  const existing = pendingAnnotationsByTab.get(tabId) || [];
  return existing.map((annotation) => {
    if (!annotation.id) {
      annotation.id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }
    return {
      id: annotation.id,
      selectedText: annotation.selectedText ?? "",
      comment: annotation.comment ?? null,
      createdAt: annotation.createdAt || new Date().toISOString()
    };
  });
}

function takePendingAnnotations(tabId) {
  const existing = pendingAnnotationsByTab.get(tabId);
  if (!existing || existing.length === 0) {
    return [];
  }
  pendingAnnotationsByTab.delete(tabId);
  return existing;
}

function isSentenceTerminatorChar(char) {
  return /[.!?。！？]/.test(char || "");
}

function findSentenceStart(text, fromIndex) {
  for (let index = Math.max(0, fromIndex - 1); index >= 0; index -= 1) {
    if (!isSentenceTerminatorChar(text[index])) {
      continue;
    }
    let start = index + 1;
    while (start < text.length && /[\s"'“”‘’)\]]/.test(text[start])) {
      start += 1;
    }
    return start;
  }
  return 0;
}

function findSentenceEnd(text, fromIndex) {
  for (let index = Math.max(0, fromIndex); index < text.length; index += 1) {
    if (!isSentenceTerminatorChar(text[index])) {
      continue;
    }
    let end = index + 1;
    while (end < text.length && /["'“”‘’)\]]/.test(text[end])) {
      end += 1;
    }
    return end;
  }
  return text.length;
}

function findSelectionBounds(documentText, selectedText) {
  const start = documentText.indexOf(selectedText);
  if (start >= 0) {
    return {
      start,
      end: start + selectedText.length
    };
  }

  const lowerDocument = documentText.toLowerCase();
  const lowerSelection = selectedText.toLowerCase();
  const lowerStart = lowerDocument.indexOf(lowerSelection);
  if (lowerStart >= 0) {
    return {
      start: lowerStart,
      end: lowerStart + selectedText.length
    };
  }

  const tokens = selectedText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (tokens.length < 2) {
    return null;
  }

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  let cursor = lowerDocument.indexOf(first.toLowerCase());
  while (cursor >= 0) {
    const tail = lowerDocument.indexOf(last.toLowerCase(), cursor + first.length);
    if (tail < 0) {
      break;
    }
    if (tail - cursor <= Math.max(600, selectedText.length * 4)) {
      return {
        start: cursor,
        end: tail + last.length
      };
    }
    cursor = lowerDocument.indexOf(first.toLowerCase(), cursor + 1);
  }

  return null;
}

function expandSelectionToFullSentences(selectedText, documentText) {
  const normalizedSelection = normalizeWhitespace(selectedText || "");
  if (!normalizedSelection) {
    return "";
  }

  const normalizedDocument = normalizeWhitespace(documentText || "");
  if (!normalizedDocument) {
    return normalizedSelection;
  }

  const bounds = findSelectionBounds(normalizedDocument, normalizedSelection);
  if (!bounds) {
    return normalizedSelection;
  }

  const start = findSentenceStart(normalizedDocument, bounds.start);
  const end = findSentenceEnd(normalizedDocument, bounds.end);
  const expanded = normalizeWhitespace(normalizedDocument.slice(start, end));
  return expanded || normalizedSelection;
}

function normalizeAnnotation(selectedText, comment, options = {}) {
  const MAX_ANNOTATION_TEXT_CHARS = 12000;
  const MAX_ANNOTATION_COMMENT_CHARS = 4000;
  const expandedText = expandSelectionToFullSentences(selectedText || "", options.documentText || "");
  const normalizedText = expandedText.trim().slice(0, MAX_ANNOTATION_TEXT_CHARS);
  const normalizedComment = (comment || "").trim().slice(0, MAX_ANNOTATION_COMMENT_CHARS);
  if (!normalizedText && !normalizedComment) {
    return null;
  }

  const parsedCreatedAt = Date.parse(String(options.createdAt || ""));
  const createdAt = Number.isNaN(parsedCreatedAt)
    ? new Date().toISOString()
    : new Date(parsedCreatedAt).toISOString();

  return {
    selectedText: normalizedText,
    comment: normalizedComment || null,
    createdAt
  };
}

function buildAnnotations(pendingAnnotations, selectedText, comment, documentText = "") {
  const combined = [];
  const dedupe = new Set();
  for (const annotation of pendingAnnotations || []) {
    const normalized = normalizeAnnotation(annotation?.selectedText ?? "", annotation?.comment ?? "", {
      documentText,
      createdAt: annotation?.createdAt
    });
    if (normalized) {
      const key = `${normalized.selectedText}\u241f${normalized.comment || ""}`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);
      combined.push(normalized);
    }
  }

  const extra = normalizeAnnotation(selectedText, comment, {
    documentText
  });
  if (extra) {
    const key = `${extra.selectedText}\u241f${extra.comment || ""}`;
    if (!dedupe.has(key)) {
      dedupe.add(key);
      combined.push(extra);
    }
  }
  return combined.length ? combined : null;
}

function normalizeTranscriptStorageMode(value) {
  if (value === "segments" || value === "both") {
    return value;
  }
  return "document_text";
}

function normalizeTranscriptTimestamp(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeTranscriptLine(value) {
  return String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function transcriptSegmentKey(segment) {
  return `${segment.timestamp || ""}\u241f${segment.text}`;
}

function collapseRepeatedTranscriptSequence(segments) {
  if (!Array.isArray(segments) || segments.length < 2) {
    return Array.isArray(segments) ? segments : [];
  }

  const keys = segments.map(transcriptSegmentKey);
  const length = keys.length;
  const candidateRepeats = [2, 3, 4];

  for (const repeat of candidateRepeats) {
    if (length % repeat !== 0) {
      continue;
    }
    const chunkLength = length / repeat;
    let repeated = true;
    for (let i = chunkLength; i < length; i += 1) {
      if (keys[i] !== keys[i % chunkLength]) {
        repeated = false;
        break;
      }
    }
    if (repeated) {
      return segments.slice(0, chunkLength);
    }
  }

  return segments;
}

function normalizeTranscriptSegmentsForStorage(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return [];
  }

  const normalized = segments
    .map((segment) => {
      const text = normalizeTranscriptLine(segment?.text || "");
      if (!text) {
        return null;
      }
      return {
        timestamp: normalizeTranscriptTimestamp(segment?.timestamp),
        text
      };
    })
    .filter(Boolean);

  const adjacentDeduped = [];
  let previousKey = null;
  for (const segment of normalized) {
    const key = transcriptSegmentKey(segment);
    if (key === previousKey) {
      continue;
    }
    adjacentDeduped.push(segment);
    previousKey = key;
  }

  return collapseRepeatedTranscriptSequence(adjacentDeduped);
}

function buildYouTubeTranscriptContent(capture, annotations, modeInput) {
  const mode = normalizeTranscriptStorageMode(modeInput);
  const transcriptSegments = normalizeTranscriptSegmentsForStorage(capture?.transcriptSegments);
  const transcriptTextFromSegments = transcriptSegments.map((segment) => segment.text).join("\n");
  const transcriptTextRaw = capture?.documentText ?? capture?.transcriptText ?? "";
  const transcriptText = transcriptSegments.length
    ? transcriptTextFromSegments
    : normalizeTranscriptLine(transcriptTextRaw);

  return {
    documentText: mode === "segments" ? "" : transcriptText,
    transcriptText: null,
    transcriptSegments: mode === "document_text" ? [] : transcriptSegments,
    annotations
  };
}

async function queueAnnotation(tabId, selectedText, comment) {
  const annotation = normalizeAnnotation(selectedText, comment);
  if (!annotation) {
    return {
      count: 0,
      annotation: null,
      annotations: getPendingAnnotationsSnapshot(tabId)
    };
  }
  const added = addPendingAnnotation(tabId, annotation);
  await notifyNotesUpdated(tabId);
  return {
    count: added.count,
    annotation: added.annotation,
    annotations: getPendingAnnotationsSnapshot(tabId)
  };
}

async function notifyInfo(tabId, title, message) {
  if (!tabId) {
    return;
  }

  const payload = { title, detail: message };
  const sent = await chrome.tabs
    .sendMessage(tabId, { type: "SHOW_INFO_TOAST", payload })
    .then(() => true)
    .catch(() => false);

  if (!sent) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("src/notify.png"),
      title,
      message
    });
  }
}

async function notifyNotesUpdated(tabId) {
  if (!tabId) {
    return;
  }
  const annotations = getPendingAnnotationsSnapshot(tabId);
  const count = annotations.length;
  await chrome.tabs
    .sendMessage(tabId, { type: "NOTES_UPDATED", payload: { count, annotations } })
    .catch(() => undefined);
}

async function clearNotesPanel(tabId) {
  if (!tabId) {
    return;
  }
  await chrome.tabs.sendMessage(tabId, { type: "CLEAR_PENDING_NOTES" }).catch(() => undefined);
}

async function handleAddHighlight(tabId, selectionOverride = "") {
  const selection = await resolveSelection(tabId, selectionOverride, {
    allowClipboardRead: true,
    allowClipboardCopy: true
  });
  const normalizedSelection = (selection || "").trim();
  if (!normalizedSelection) {
    await notifyInfo(
      tabId,
      "No selection",
      "Select text in the PDF and right-click Add highlight. If needed, copy the text first and retry."
    );
    return;
  }
  const queued = await queueAnnotation(tabId, normalizedSelection, "");
  if (queued.count > 0) {
    await notifyInfo(
      tabId,
      "Highlight added",
      `${queued.count} highlight${queued.count === 1 ? "" : "s"} queued.`
    );
  } else {
    await notifyInfo(
      tabId,
      "No selection",
      "Select text in the PDF and right-click Add highlight. If needed, copy the text first and retry."
    );
  }
}

async function handleAddNote(tabId, selectionOverride = "") {
  const capture = await captureFromTab(tabId, "CAPTURE_SELECTION_WITH_COMMENT");
  if (!capture?.ok) {
    if (capture?.missingReceiver) {
      const comment = await requestCommentFromExtension();
      if (comment === null) {
        return;
      }
      const selection = await resolveSelection(tabId, selectionOverride, {
        allowClipboardRead: true,
        allowClipboardCopy: true
      });
      const normalizedSelection = (selection || "").trim();
      if (!normalizedSelection) {
        await notifyInfo(
          tabId,
          "No selection",
          "Select text in the PDF and right-click Add highlight and note. If needed, copy the text first and retry."
        );
        return;
      }
      const queued = await queueAnnotation(tabId, normalizedSelection, comment);
      if (queued.count > 0) {
        await notifyInfo(
          tabId,
          "Highlight added",
          `${queued.count} highlight${queued.count === 1 ? "" : "s"} queued.`
        );
      } else {
        await notifyInfo(
          tabId,
          "No selection",
          "Select text in the PDF and right-click Add highlight and note. If needed, copy the text first and retry."
        );
      }
      return;
    }
    throw new Error(capture?.error || "Failed to capture selection");
  }

  const selection =
    capture.selectedText && capture.selectedText.trim()
      ? capture.selectedText.trim()
      : await resolveSelection(tabId, selectionOverride, {
          allowClipboardRead: true,
          allowClipboardCopy: true
        });
  const normalizedSelection = (selection || "").trim();
  if (!normalizedSelection) {
    await notifyInfo(
      tabId,
      "No selection",
      "Select text in the PDF and right-click Add highlight and note. If needed, copy the text first and retry."
    );
    return;
  }
  const queued = await queueAnnotation(tabId, normalizedSelection, capture.comment ?? "");
  if (queued.count > 0) {
    await notifyInfo(
      tabId,
      "Highlight added",
      `${queued.count} highlight${queued.count === 1 ? "" : "s"} queued.`
    );
  } else {
    await notifyInfo(tabId, "No selection", "Select text to add a highlight.");
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    return false;
  }

  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) {
    return true;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DOM_PARSER"],
    justification: "Extract text from PDF documents"
  });

  return true;
}

async function extractPdfViaOffscreen(url, allowUnknownContentType) {
  const ok = await ensureOffscreenDocument();
  if (!ok) {
    throw new Error("Offscreen document unavailable");
  }

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_EXTRACT_PDF",
    url,
    allowUnknownContentType
  });

  if (!response?.ok) {
    throw new Error(response?.error || "PDF extraction failed");
  }

  return response.data;
}

async function readClipboardTextViaOffscreen() {
  const ok = await ensureOffscreenDocument();
  if (!ok) {
    return "";
  }

  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_READ_CLIPBOARD"
  });

  if (!response?.ok) {
    return "";
  }

  return String(response.text || "").trim();
}

async function copySelectionFromPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        try {
          return document.execCommand("copy");
        } catch (_error) {
          return false;
        }
      }
    });
    return Array.isArray(results) && results.some((item) => Boolean(item?.result));
  } catch (_error) {
    return false;
  }
}

function slugifySegment(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function formatDateFolder(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSubdirectories(record, settings) {
  const segments = [JSON_OUTPUT_ROOT_DIR];
  const typeSegment = settings.organizeByType
    ? slugifySegment(record.captureType || "capture") || "capture"
    : null;
  const dateSegment = settings.organizeByDate ? formatDateFolder(record.savedAt) : null;
  const order = settings.organizeOrder === "date_type" ? "date_type" : "type_date";

  if (order === "date_type") {
    if (dateSegment) {
      segments.push(dateSegment);
    }
    if (typeSegment) {
      segments.push(typeSegment);
    }
  } else {
    if (typeSegment) {
      segments.push(typeSegment);
    }
    if (dateSegment) {
      segments.push(dateSegment);
    }
  }

  return segments;
}

function formatStoredPath(fileName, subdirectories) {
  if (!subdirectories || subdirectories.length === 0) {
    return fileName;
  }

  return `${subdirectories.join("/")}/${fileName}`;
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function selectionMatchesParts(selection, parts, normalize = false) {
  if (!selection || !Array.isArray(parts)) {
    return false;
  }
  for (const part of parts) {
    if (!part) {
      continue;
    }
    const haystack = normalize ? normalizeWhitespace(part) : part;
    if (haystack.includes(selection)) {
      return true;
    }
  }
  return false;
}

async function resolvePdfSelection(pdfData, selectedText) {
  const trimmed = (selectedText || "").trim();
  if (trimmed) {
    return { text: trimmed, source: "selection" };
  }

  const clipboard = await readClipboardTextViaOffscreen();
  const clipTrimmed = (clipboard || "").trim();
  if (!clipTrimmed) {
    return { text: "", source: "none" };
  }

  if (selectionMatchesParts(clipTrimmed, pdfData?.documentTextParts)) {
    return { text: clipTrimmed, source: "clipboard" };
  }

  const normalizedClip = normalizeWhitespace(clipTrimmed);
  if (normalizedClip && selectionMatchesParts(normalizedClip, pdfData?.documentTextParts, true)) {
    return { text: normalizedClip, source: "clipboard_normalized" };
  }

  return { text: "", source: "none" };
}

async function saveRecord(record, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);

  const settings = await getSettings();
  throwIfAborted(signal);
  const directoryHandle = await getSavedDirectoryHandle();

  if (!directoryHandle) {
    chrome.runtime.openOptionsPage();
    throw new Error("No folder selected. Open extension settings and choose a folder first.");
  }

  const allowed = await ensureReadWritePermission(directoryHandle);
  if (!allowed) {
    chrome.runtime.openOptionsPage();
    throw new Error("Folder permission denied. Re-select your folder in settings.");
  }
  throwIfAborted(signal);

  const storageBackend =
    settings.storageBackend === "sqlite" || settings.storageBackend === "both"
      ? settings.storageBackend
      : "json";
  const writesSqlite = storageBackend === "sqlite" || storageBackend === "both";
  const writesJson = storageBackend === "json" || storageBackend === "both";

  let processed = await applyContentPolicies(record, settings);
  throwIfAborted(signal);
  if (writesJson && settings.includeJsonChunks === true) {
    processed = {
      ...processed,
      content: {
        ...(processed.content || {}),
        chunks: buildJsonChunksForRecord(processed)
      }
    };
  }
  throwIfAborted(signal);

  const validation = validateCaptureRecord(processed);
  if (!validation.valid) {
    throw new Error(`Schema validation failed: ${validation.errors.join(", ")}`);
  }

  let sqliteFileName = null;
  let sqliteError = null;
  if (writesSqlite) {
    throwIfAborted(signal);
    try {
      sqliteFileName = await saveRecordToSqlite(directoryHandle, processed);
    } catch (error) {
      sqliteError = error;
    }
  }

  let jsonStoredPath = null;
  let jsonError = null;
  if (writesJson) {
    throwIfAborted(signal);
    const fileName = buildFileName(processed);
    const subdirectories = buildSubdirectories(processed, settings);
    try {
      await writeJsonToDirectory(directoryHandle, fileName, processed, subdirectories);
      jsonStoredPath = formatStoredPath(fileName, subdirectories);
    } catch (error) {
      jsonError = error;
    }
  }

  if (writesJson && writesSqlite) {
    if (sqliteError && jsonError) {
      chrome.runtime.openOptionsPage();
      throw new Error(
        `Failed to write capture to JSON and SQLite: ` +
          `json=${errorMessage(jsonError, "JSON write failed")}, ` +
          `sqlite=${errorMessage(sqliteError, "SQLite write failed")}`
      );
    }
    if (sqliteError && jsonStoredPath) {
      return {
        fileName: `${jsonStoredPath} | sqlite write failed: ${errorMessage(
          sqliteError,
          "SQLite write failed"
        )}`,
        record: processed
      };
    }
    if (jsonError && sqliteFileName) {
      return {
        fileName: `${sqliteFileName} | json write failed: ${errorMessage(
          jsonError,
          "JSON write failed"
        )}`,
        record: processed
      };
    }
    return {
      fileName: `${jsonStoredPath} | ${sqliteFileName}`,
      record: processed
    };
  }

  if (writesSqlite && sqliteError) {
    chrome.runtime.openOptionsPage();
    throw sqliteError;
  }
  if (writesJson && jsonError) {
    chrome.runtime.openOptionsPage();
    throw jsonError;
  }

  return {
    fileName: writesJson ? jsonStoredPath : sqliteFileName,
    record: processed
  };
}

async function assertFolderAccess() {
  const directoryHandle = await getSavedDirectoryHandle();
  if (!directoryHandle) {
    chrome.runtime.openOptionsPage();
    throw new Error("No folder selected. Open extension settings and choose a folder first.");
  }

  const allowed = await ensureReadWritePermission(directoryHandle);
  if (!allowed) {
    chrome.runtime.openOptionsPage();
    throw new Error("Folder permission denied. Re-select your folder in settings.");
  }
}

async function requestCommentFromExtension() {
  const requestId = crypto.randomUUID();
  const url = chrome.runtime.getURL(`src/comment.html?requestId=${requestId}`);
  const popup = await chrome.windows.create({
    url,
    type: "popup",
    width: 420,
    height: 320
  });

  return new Promise((resolve) => {
    if (!popup?.id) {
      resolve(null);
      return;
    }

    commentRequests.set(requestId, {
      resolve,
      windowId: popup.id
    });
  });
}

function resolveNestedUrlCandidate(value, baseUrl) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

function resolvePdfUrl(rawUrl, depth = 0) {
  if (!rawUrl) {
    return null;
  }
  if (depth > 3) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const params = ["file", "src", "url", "doc"];
    for (const key of params) {
      const paramValue = parsed.searchParams.get(key);
      if (!paramValue) {
        continue;
      }

      const nestedCandidates = [paramValue];
      try {
        const decoded = decodeURIComponent(paramValue);
        if (decoded && decoded !== paramValue) {
          nestedCandidates.push(decoded);
        }
      } catch (_error) {
        // Ignore malformed encodings.
      }

      for (const nested of nestedCandidates) {
        const resolved = resolveNestedUrlCandidate(nested, parsed.toString());
        if (!resolved) {
          continue;
        }
        return resolvePdfUrl(resolved, depth + 1);
      }
    }

    return parsed.toString();
  } catch (_error) {
    return rawUrl;
  }
}

function isLikelyPdfUrl(url) {
  const resolved = resolvePdfUrl(url) || url || "";
  try {
    const parsed = new URL(resolved);
    if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
      return true;
    }
    return /\.pdf([?#]|$)/i.test(parsed.search || "") || /\.pdf([?#]|$)/i.test(parsed.hash || "");
  } catch (_error) {
    return /\.pdf([?#]|$)/i.test(String(resolved));
  }
}

async function updateMenusForUrl(url) {
  const isYouTube = isYouTubeUrl(url);
  await Promise.all([
    chrome.contextMenus.update(MENU_SAVE_SELECTION, { visible: !isYouTube }),
    chrome.contextMenus.update(MENU_SAVE_WITH_COMMENT, { visible: !isYouTube }),
    chrome.contextMenus.update(MENU_ADD_HIGHLIGHT, { visible: !isYouTube }),
    chrome.contextMenus.update(MENU_ADD_NOTE, { visible: !isYouTube }),
    chrome.contextMenus.update(MENU_SAVE_YOUTUBE_TRANSCRIPT, { visible: isYouTube }),
    chrome.contextMenus.update(MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT, { visible: isYouTube })
  ]).catch(() => undefined);
}

async function refreshMenusForActiveTab() {
  const tab = await getActiveTab();
  await updateMenusForUrl(tab?.url || "");
}

async function handlePdfCapture(
  tabId,
  { selectedText = "", comment = "", annotations = [], includeSelectionAnnotation = true } = {}
) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url) {
    throw new Error("No active tab URL");
  }

  const resolvedUrl = resolvePdfUrl(tab.url) || tab.url;
  const likelyPdf = isLikelyPdfUrl(resolvedUrl);
  let pdfData;
  try {
    pdfData = await extractPdfViaOffscreen(resolvedUrl, likelyPdf);
  } catch (_offscreenError) {
    try {
      pdfData = await extractPdfFromModule(resolvedUrl, {
        allowUnknownContentType: likelyPdf,
        disableWorker: true
      });
    } catch (_moduleError) {
      throw new Error("PDF extraction failed in both offscreen and worker contexts.");
    }
  }
  const url = resolvedUrl;
  let site = null;
  try {
    site = new URL(url).hostname || null;
  } catch (_error) {
    site = null;
  }
  const title = String(
    pdfData?.info?.Title ||
      tab.title ||
      (typeof url === "string" ? url.split("/").pop() : null) ||
      "PDF Document"
  ).trim() || "PDF Document";

  const pdfInfo = pdfData?.info || {};
  const pdfInfoSummary = {
    title: pdfInfo.Title || null,
    author: pdfInfo.Author || null,
    subject: pdfInfo.Subject || null,
    keywords: pdfInfo.Keywords || null,
    creator: pdfInfo.Creator || null,
    producer: pdfInfo.Producer || null,
    creationDate: pdfInfo.CreationDate || null,
    modificationDate: pdfInfo.ModDate || null,
    isEncrypted: typeof pdfInfo.IsEncrypted === "boolean" ? pdfInfo.IsEncrypted : null,
    pdfVersion: pdfInfo.PDFFormatVersion || null
  };

  const resolvedSelection = await resolvePdfSelection(pdfData, selectedText);
  const pdfDocumentText = Array.isArray(pdfData?.documentTextParts)
    ? pdfData.documentTextParts.join(" ")
    : "";
  const annotationSelectionText = includeSelectionAnnotation ? resolvedSelection.text : "";

  const record = buildCaptureRecord({
    captureType: "pdf_document",
    source: {
      url,
      title,
      site,
      language: null,
      publishedAt: null,
      metadata: {
        pdfPageCount: pdfData.pageCount,
        pdfContentType: pdfData.contentType || null,
        pdfFileSizeBytes: pdfData.fileSizeBytes,
        pdfTextLength: pdfData.documentTextLength ?? null,
        pdfInfo: pdfInfoSummary,
        pdfPageErrorCount: pdfData.pageErrorCount || 0
      }
    },
    content: {
      documentTextParts: pdfData.documentTextParts,
      annotations: buildAnnotations(annotations, annotationSelectionText, comment, pdfDocumentText)
    },
    diagnostics: {
      missingFields: ["publishedAt"],
      selectionSource: resolvedSelection.source
    }
  });

  const { fileName, record: savedRecord } = await saveRecord(record);
  return { fileName, record: savedRecord };
}

async function notifySaved(tabId, record, fileName) {
  if (!tabId) {
    return;
  }

  const annotations = Array.isArray(record.content?.annotations) ? record.content.annotations : [];
  const lastAnnotation = annotations.length ? annotations[annotations.length - 1] : null;

  const payload = {
    captureType: record.captureType,
    title: record.source?.title || null,
    annotationCount: annotations.length,
    lastAnnotation,
    fileName
  };

  await chrome.tabs.sendMessage(tabId, { type: "SHOW_SAVE_TOAST", payload }).catch(() => undefined);
}

async function notifyStart(tabId, kindLabel, forceNotification = false) {
  if (!tabId) {
    return;
  }

  const payload = {
    title: "Capturing content",
    detail: kindLabel === "youtube_transcript" ? "Loading transcript..." : "Loading page content..."
  };

  let sent = false;
  if (!forceNotification) {
    sent = await chrome.tabs
      .sendMessage(tabId, { type: "SHOW_PROGRESS_TOAST", payload })
      .then(() => true)
      .catch(() => false);
  }

  if (!sent) {
    chrome.notifications.create(START_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("src/notify.png"),
      title: "Capturing content",
      message: "Loading content from this page..."
    });
  }
}

async function notifyError(tabId, error) {
  if (!tabId) {
    return;
  }

  const message = error?.message || "Capture failed";
  const sent = await chrome.tabs
    .sendMessage(tabId, { type: "SHOW_ERROR_TOAST", payload: { message } })
    .then(() => true)
    .catch(() => false);

  if (!sent) {
    chrome.notifications.create(ERROR_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("src/notify.png"),
      title: "Capture failed",
      message
    });
  }
}

async function handleSelectionSave(tabId, selectionOverride = "", options = {}) {
  const includeSelectionAnnotation = options.includeSelectionAnnotation === true;
  const signal = options.signal || null;
  throwIfAborted(signal);

  const capture = await captureFromTab(tabId, "CAPTURE_SELECTION");
  throwIfAborted(signal);
  if (!capture?.ok) {
    if (capture?.missingReceiver) {
      const selection = await resolveSelection(tabId, selectionOverride, {
        allowClipboardRead: true,
        allowClipboardCopy: true
      });
      return handlePdfCapture(tabId, {
        selectedText: selection,
        includeSelectionAnnotation
      });
    }
    throw new Error(capture?.error || "Failed to capture selection");
  }
  const pendingAnnotations = takePendingAnnotations(tabId);
  if (capture?.isPdf) {
    const resolvedSelection = await resolveSelection(
      tabId,
      selectionOverride || capture.selectedText || "",
      {
        allowClipboardRead: true,
        allowClipboardCopy: true
      }
    );
    return handlePdfCapture(tabId, {
      selectedText: resolvedSelection,
      annotations: pendingAnnotations,
      includeSelectionAnnotation
    });
  }

  const selectionForAnnotation = includeSelectionAnnotation ? capture.selectedText ?? "" : "";
  const record = buildCaptureRecord({
    captureType: "selected_text",
    source: capture.source,
    content: {
      documentText: capture.documentText,
      annotations: buildAnnotations(
        pendingAnnotations,
        selectionForAnnotation,
        null,
        capture.documentText || ""
      )
    },
    diagnostics: capture.diagnostics
  });

  const { fileName, record: savedRecord } = await saveRecord(record, { signal });
  return { fileName, record: savedRecord };
}

async function handleSelectionSaveWithComment(tabId, selectionOverride = "", options = {}) {
  const includeSelectionAnnotation = options.includeSelectionAnnotation === true;
  const signal = options.signal || null;
  throwIfAborted(signal);

  const capture = await captureFromTab(tabId, "CAPTURE_SELECTION_WITH_COMMENT");
  throwIfAborted(signal);
  if (!capture?.ok) {
    if (capture?.missingReceiver) {
      const comment = await requestCommentFromExtension();
      if (comment === null) {
        throw new Error("Comment cancelled");
      }
      const selection = await resolveSelection(tabId, selectionOverride, {
        allowClipboardRead: true,
        allowClipboardCopy: true
      });
      return handlePdfCapture(tabId, {
        selectedText: selection,
        comment,
        includeSelectionAnnotation
      });
    }
    throw new Error(capture?.error || "Failed to capture selection");
  }
  const pendingAnnotations = takePendingAnnotations(tabId);
  if (capture?.isPdf) {
    const resolvedSelection = await resolveSelection(
      tabId,
      selectionOverride || capture.selectedText || "",
      {
        allowClipboardRead: true,
        allowClipboardCopy: true
      }
    );
    return handlePdfCapture(tabId, {
      selectedText: resolvedSelection,
      comment: capture.comment ?? "",
      annotations: pendingAnnotations,
      includeSelectionAnnotation
    });
  }

  const selectionForAnnotation = includeSelectionAnnotation ? capture.selectedText ?? "" : "";
  const record = buildCaptureRecord({
    captureType: "selected_text",
    source: capture.source,
    content: {
      documentText: capture.documentText,
      annotations: buildAnnotations(
        pendingAnnotations,
        selectionForAnnotation,
        capture.comment ?? "",
        capture.documentText || ""
      )
    },
    diagnostics: capture.diagnostics
  });

  const { fileName, record: savedRecord } = await saveRecord(record, { signal });
  return { fileName, record: savedRecord };
}

async function handleYouTubeTranscriptSave(tabId, withComment = false, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);

  const settings = await getSettings();
  throwIfAborted(signal);
  const transcriptStorageMode = normalizeTranscriptStorageMode(
    settings.youtubeTranscriptStorageMode
  );

  let capture = await captureFromTab(
    tabId,
    withComment ? "CAPTURE_YOUTUBE_TRANSCRIPT_WITH_COMMENT" : "CAPTURE_YOUTUBE_TRANSCRIPT",
    { frameId: 0 }
  );
  throwIfAborted(signal);
  if (!capture?.ok) {
    throw new Error(capture?.error || "Failed to capture YouTube transcript");
  }

  const hasSegments =
    Array.isArray(capture.transcriptSegments) && capture.transcriptSegments.length > 0;
  if (!hasSegments) {
    const fallback = await captureYouTubeTranscriptFromMainWorld(tabId);
    throwIfAborted(signal);
    if (fallback?.ok && Array.isArray(fallback.segments) && fallback.segments.length > 0) {
      const missingFields = Array.isArray(capture?.diagnostics?.missingFields)
        ? capture.diagnostics.missingFields.filter((field) => field !== "transcript")
        : [];

      capture = {
        ...capture,
        documentText: fallback.transcriptText || capture.documentText || "",
        transcriptText: fallback.transcriptText || capture.transcriptText || null,
        transcriptSegments: fallback.segments,
        source: {
          ...(capture.source || {}),
          metadata: {
            ...(capture.source?.metadata || {}),
            transcriptStatus: "transcript_available",
            transcriptSource: fallback.source || "main_world_dom"
          }
        },
        diagnostics: {
          ...(capture.diagnostics || {}),
          missingFields,
          transcriptSource: fallback.source || "main_world_dom",
          transcriptOpenedByExtension:
            Boolean(capture.diagnostics?.transcriptOpenedByExtension) || Boolean(fallback.opened),
          mainWorldFallbackUsed: true,
          mainWorldFallbackSegmentCount: fallback.segmentCount || 0,
          reason: null
        }
      };
    } else {
      capture = {
        ...capture,
        diagnostics: {
          ...(capture.diagnostics || {}),
          mainWorldFallbackUsed: true,
          mainWorldFallbackSegmentCount: fallback?.segmentCount || 0
        }
      };
    }
  }

  const pendingAnnotations = takePendingAnnotations(tabId);
  const comment = withComment ? capture.comment ?? "" : "";
  const annotations = buildAnnotations(pendingAnnotations, "", comment);
  const content = buildYouTubeTranscriptContent(capture, annotations, transcriptStorageMode);
  const record = buildCaptureRecord({
    captureType: "youtube_transcript",
    source: capture.source,
    content,
    diagnostics: {
      ...(capture.diagnostics || {}),
      transcriptStorageMode,
      persistedDocumentTextLength: (content.documentText || "").length,
      persistedTranscriptSegmentCount: Array.isArray(content.transcriptSegments)
        ? content.transcriptSegments.length
        : 0
    }
  });

  const { fileName, record: savedRecord } = await saveRecord(record, { signal });
  return { fileName, record: savedRecord };
}

async function runAction(kind, tabId, selectionOverride = "", options = {}) {
  const signal = options.signal || null;
  let kindLabel = "selection";
  let resolvedKind = kind;
  try {
    throwIfAborted(signal);

    if (kind === INTERNAL_SAVE_SELECTION_WITH_HIGHLIGHT) {
      kindLabel = "selection_with_highlight";
    }
    if (kind === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
      kindLabel = "youtube_transcript";
    }
    if (kind === COMMAND_SAVE_SELECTION_WITH_COMMENT || kind === MENU_SAVE_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
    }

    await assertFolderAccess();
    throwIfAborted(signal);
    let forceNotification = false;
    let isYouTube = false;
    try {
      const tab = await chrome.tabs.get(tabId);
      const resolved = resolvePdfUrl(tab?.url) || tab?.url;
      forceNotification = resolved ? isLikelyPdfUrl(resolved) : false;
      isYouTube = resolved ? isYouTubeUrl(resolved) : false;
    } catch (_error) {
      forceNotification = false;
      isYouTube = false;
    }

    if (isYouTube) {
      if (kind === MENU_SAVE_SELECTION || kind === COMMAND_SAVE_SELECTION) {
        resolvedKind = MENU_SAVE_YOUTUBE_TRANSCRIPT;
        kindLabel = "youtube_transcript";
      }
      if (kind === MENU_SAVE_WITH_COMMENT || kind === COMMAND_SAVE_SELECTION_WITH_COMMENT) {
        resolvedKind = MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT;
        kindLabel = "youtube_transcript";
      }
    }

    await notifyStart(tabId, kindLabel, forceNotification);
    throwIfAborted(signal);

    if (resolvedKind === MENU_SAVE_SELECTION || resolvedKind === COMMAND_SAVE_SELECTION) {
      const { fileName, record } = await handleSelectionSave(tabId, selectionOverride, {
        includeSelectionAnnotation: false,
        signal
      });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved capture", fileName);
      return { ok: true, fileName };
    }

    if (resolvedKind === INTERNAL_SAVE_SELECTION_WITH_HIGHLIGHT) {
      const { fileName, record } = await handleSelectionSave(tabId, selectionOverride, {
        includeSelectionAnnotation: true,
        signal
      });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection_with_highlight", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved capture with highlight", fileName);
      return { ok: true, fileName };
    }

    if (resolvedKind === COMMAND_SAVE_SELECTION_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
      const { fileName, record } = await handleSelectionSaveWithComment(tabId, selectionOverride, {
        includeSelectionAnnotation: false,
        signal
      });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection_with_note", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved capture with note", fileName);
      return { ok: true, fileName };
    }

    if (resolvedKind === MENU_SAVE_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
      const { fileName, record } = await handleSelectionSaveWithComment(tabId, selectionOverride, {
        includeSelectionAnnotation: false,
        signal
      });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection_with_note", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved capture with note", fileName);
      return { ok: true, fileName };
    }

    if (resolvedKind === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
      kindLabel = "youtube_transcript";
      const { fileName, record } = await handleYouTubeTranscriptSave(tabId, false, { signal });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "youtube_transcript", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved capture", fileName);
      return { ok: true, fileName };
    }

    if (resolvedKind === MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT) {
      kindLabel = "youtube_transcript";
      const { fileName, record } = await handleYouTubeTranscriptSave(tabId, true, { signal });
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "transcript_with_note", fileName });
      await notifySaved(tabId, record, fileName);
      await clearNotesPanel(tabId);
      console.info("Saved transcript with note", fileName);
      return { ok: true, fileName };
    }

    throw new Error("Unknown action");
  } catch (error) {
    await setBadge(tabId, "ERR", "#c62828");
    chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
    await notifyError(tabId, error);
    await setLastCaptureStatus({
      ok: false,
      kind: kindLabel,
      error: error?.message || "Unknown error"
    });
    if (error?.message?.includes("No folder selected")) {
      chrome.runtime.openOptionsPage();
    }
    console.error(error);
    return {
      ok: false,
      error: error?.message || "Unknown error"
    };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus()
    .then(refreshMenusForActiveTab)
    .catch((error) => console.error("Failed to create context menus", error));
});

chrome.runtime.onStartup.addListener(() => {
  createMenus()
    .then(refreshMenusForActiveTab)
    .catch((error) => console.error("Failed to create context menus", error));
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [requestId, entry] of commentRequests.entries()) {
    if (entry.windowId === windowId) {
      commentRequests.delete(requestId);
      entry.resolve(null);
      break;
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cancelCaptureQueueForTab(tabId, "Capture cancelled because the tab was closed.");
  pendingAnnotationsByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    cancelCaptureQueueForTab(tabId, "Capture cancelled because the page started loading.");
    pendingAnnotationsByTab.delete(tabId);
    clearNotesPanel(tabId).catch(() => undefined);
  }
  if (changeInfo.url) {
    updateMenusForUrl(changeInfo.url).catch(() => undefined);
  }
});

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs
    .get(info.tabId)
    .then((tab) => updateMenusForUrl(tab?.url || ""))
    .catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  if (info.menuItemId === MENU_SAVE_SELECTION) {
    queueCaptureAction(MENU_SAVE_SELECTION, tab.id, info.selectionText || "").catch((error) =>
      console.error(error)
    );
    return;
  }

  if (info.menuItemId === MENU_SAVE_WITH_COMMENT) {
    queueCaptureAction(MENU_SAVE_WITH_COMMENT, tab.id, info.selectionText || "").catch((error) =>
      console.error(error)
    );
    return;
  }

  if (info.menuItemId === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
    queueCaptureAction(MENU_SAVE_YOUTUBE_TRANSCRIPT, tab.id).catch((error) => console.error(error));
    return;
  }

  if (info.menuItemId === MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT) {
    queueCaptureAction(MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT, tab.id).catch((error) =>
      console.error(error)
    );
    return;
  }

  if (info.menuItemId === MENU_ADD_HIGHLIGHT) {
    const selectionOverride = info.selectionText || "";
    handleAddHighlight(tab.id, selectionOverride).catch((error) => console.error(error));
    return;
  }

  if (info.menuItemId === MENU_ADD_NOTE) {
    const selectionOverride = info.selectionText || "";
    handleAddNote(tab.id, selectionOverride).catch((error) => console.error(error));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-selection" && command !== "save-selection-with-comment") {
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  if (command === "save-selection") {
    queueCaptureAction(COMMAND_SAVE_SELECTION, tab.id).catch((error) => console.error(error));
    return;
  }

  queueCaptureAction(COMMAND_SAVE_SELECTION_WITH_COMMENT, tab.id).catch((error) => console.error(error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_YT_PLAYER_RESPONSE") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }

    chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          try {
            const win = /** @type {any} */ (window);
            const direct =
              win.ytInitialPlayerResponse ||
              win.ytInitialData?.playerResponse ||
              win.__INITIAL_PLAYER_RESPONSE__ ||
              null;
            if (direct) {
              return direct;
            }

            const config = win.ytcfg?.get?.("PLAYER_VARS");
            const embedded = config?.embedded_player_response || null;
            if (!embedded) {
              return null;
            }
            if (typeof embedded === "string") {
              try {
                return JSON.parse(embedded);
              } catch (_error) {
                return null;
              }
            }
            return embedded;
          } catch (_error) {
            return null;
          }
        }
      })
      .then((results) => {
        const value = Array.isArray(results) ? results[0]?.result : null;
        sendResponse({ ok: true, playerResponse: value || null });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "Failed to read player response" });
      });
    return true;
  }

  if (message?.type === "YT_FETCH_TEXT") {
    let allowedUrl = null;
    try {
      allowedUrl = assertAllowedYouTubeFetchUrl(message.url);
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Blocked fetch URL." });
      return true;
    }

    fetch(allowedUrl, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Fetch failed (${response.status})`);
        }
        const text = await response.text();
        sendResponse({ ok: true, text });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "Fetch failed" });
      });
    return true;
  }

  if (message?.type === "YT_FETCH_JSON") {
    let allowedUrl = null;
    try {
      allowedUrl = assertAllowedYouTubeFetchUrl(message.url);
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Blocked fetch URL." });
      return true;
    }

    fetch(allowedUrl, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Fetch failed (${response.status})`);
        }
        const json = await response.json();
        sendResponse({ ok: true, json });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "Fetch failed" });
      });
    return true;
  }

  if (message?.type === "RESOLVE_PDF_SELECTION") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }

    resolveSelection(tabId, "", {
      allowClipboardRead: false,
      allowClipboardCopy: message.allowClipboardCopy === true
    })
      .then((selectedText) => {
        sendResponse({ ok: true, selectedText: selectedText || "" });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to resolve selection"
        });
      });
    return true;
  }
  if (message?.type === "ADD_NOTE") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }

    queueAnnotation(tabId, message.selectedText ?? "", message.comment ?? "")
      .then((result) => {
        if (!result.count) {
          sendResponse({ ok: false, error: "No selection to add." });
          return;
        }
        sendResponse({
          ok: true,
          count: result.count,
          annotation: result.annotation,
          annotations: result.annotations
        });
      })
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Failed to add note" })
      );
    return true;
  }

  if (message?.type === "GET_PENDING_NOTES") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }
    const annotations = getPendingAnnotationsSnapshot(tabId);
    sendResponse({ ok: true, count: annotations.length, annotations });
    return true;
  }

  if (message?.type === "REMOVE_PENDING_NOTE") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }

    const result = removePendingAnnotation(tabId, message.annotationId || null);
    notifyNotesUpdated(tabId)
      .then(() => {
        const annotations = getPendingAnnotationsSnapshot(tabId);
        sendResponse({
          ok: true,
          removed: result.removed,
          count: annotations.length,
          annotations
        });
      })
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Failed to remove note" })
      );
    return true;
  }

  if (message?.type === "CLEAR_PENDING_NOTES_STATE") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No active tab" });
      return true;
    }
    clearPendingAnnotations(tabId);
    notifyNotesUpdated(tabId)
      .then(() => sendResponse({ ok: true, count: 0, annotations: [] }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Failed to clear notes" })
      );
    return true;
  }

  if (message?.type === "COMMENT_SUBMIT") {
    const requestId = message.requestId;
    const entry = commentRequests.get(requestId);
    if (!entry) {
      sendResponse({ ok: false, error: "Unknown request" });
      return true;
    }

    commentRequests.delete(requestId);
    if (entry.windowId) {
      chrome.windows.remove(entry.windowId).catch(() => undefined);
    }

    if (message.cancelled) {
      entry.resolve(null);
    } else {
      entry.resolve(message.comment ?? "");
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "GET_LAST_CAPTURE_STATUS") {
    getLastCaptureStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to load status" }));
    return true;
  }

  if (message?.type === "RUN_CAPTURE") {
    getActiveTab()
      .then(async (tab) => {
        if (!tab?.id) {
          throw new Error("No active tab");
        }

        if (message.kind === "selection") {
          return queueCaptureAction("COMMAND_SAVE_SELECTION", tab.id);
        }

        if (message.kind === "selection_with_comment") {
          return queueCaptureAction("COMMAND_SAVE_SELECTION_WITH_COMMENT", tab.id);
        }

        if (message.kind === "selection_with_highlight") {
          return queueCaptureAction(INTERNAL_SAVE_SELECTION_WITH_HIGHLIGHT, tab.id);
        }

        if (message.kind === "youtube_transcript") {
          return queueCaptureAction(MENU_SAVE_YOUTUBE_TRANSCRIPT, tab.id);
        }

        if (message.kind === "youtube_transcript_with_comment") {
          return queueCaptureAction(MENU_SAVE_YOUTUBE_TRANSCRIPT_WITH_COMMENT, tab.id);
        }

        throw new Error("Unknown capture type");
      })
      .then((result) => sendResponse(result || { ok: false, error: "No result" }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Capture failed" }));
    return true;
  }

  return undefined;
});
