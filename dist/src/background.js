import { applyContentPolicies } from "./processing.js";
import { buildCaptureRecord, buildFileName, validateCaptureRecord } from "./schema.js";
import { getLastCaptureStatus, getSettings, setLastCaptureStatus } from "./settings.js";
import { extractPdfFromUrl } from "./pdf.js";
import { saveRecordToSqlite } from "./sqlite.js";
import {
  ensureReadWritePermission,
  getSavedDirectoryHandle,
  writeJsonToDirectory
} from "./storage.js";

const MENU_SAVE_SELECTION = "save-selection";
const MENU_SAVE_WITH_COMMENT = "save-with-comment";
const MENU_SAVE_YOUTUBE_TRANSCRIPT = "save-youtube-transcript";
const COMMAND_SAVE_SELECTION = "COMMAND_SAVE_SELECTION";
const COMMAND_SAVE_SELECTION_WITH_COMMENT = "COMMAND_SAVE_SELECTION_WITH_COMMENT";

const commentRequests = new Map();
const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen.html");
const START_NOTIFICATION_ID = "capture-start";
const ERROR_NOTIFICATION_ID = "capture-error";

async function createMenus() {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_SAVE_SELECTION,
    title: "Save content",
    contexts: ["page", "selection"]
  });

  chrome.contextMenus.create({
    id: MENU_SAVE_WITH_COMMENT,
    title: "Save with comment",
    contexts: ["page", "selection"]
  });

  chrome.contextMenus.create({
    id: MENU_SAVE_YOUTUBE_TRANSCRIPT,
    title: "Save YouTube transcript",
    contexts: ["page"],
    documentUrlPatterns: ["https://www.youtube.com/*"]
  });
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0] || null);
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

async function captureFromTab(tabId, messageType) {
  if (!tabId) {
    throw new Error("No active tab");
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { type: messageType });
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "No content script available",
      missingReceiver: true
    };
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
  const segments = [];
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

async function saveRecord(record) {
  const settings = await getSettings();
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

  const processed = await applyContentPolicies(record, settings);
  const validation = validateCaptureRecord(processed);
  if (!validation.valid) {
    throw new Error(`Schema validation failed: ${validation.errors.join(", ")}`);
  }

  if (settings.storageBackend === "sqlite") {
    try {
      const dbFileName = await saveRecordToSqlite(directoryHandle, processed);
      return { fileName: dbFileName, record: processed };
    } catch (error) {
      chrome.runtime.openOptionsPage();
      throw error;
    }
  }

  const fileName = buildFileName(processed);
  const subdirectories = buildSubdirectories(processed, settings);
  try {
    await writeJsonToDirectory(directoryHandle, fileName, processed, subdirectories);
  } catch (error) {
    chrome.runtime.openOptionsPage();
    throw error;
  }
  return { fileName: formatStoredPath(fileName, subdirectories), record: processed };
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

function isLikelyPdfUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith(".pdf");
  } catch (_error) {
    return false;
  }
}

function resolvePdfUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const fileParam = parsed.searchParams.get("file");
    if (fileParam) {
      try {
        return new URL(fileParam).toString();
      } catch (_error) {
        try {
          const decoded = decodeURIComponent(fileParam);
          return encodeURI(decoded);
        } catch (_err) {
          return fileParam;
        }
      }
    }
  } catch (_error) {
    return rawUrl;
  }

  return rawUrl;
}

async function handlePdfCapture(tabId, comment = null, selectedText = "") {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url) {
    throw new Error("No active tab URL");
  }

  const resolvedUrl = resolvePdfUrl(tab.url) || tab.url;
  const likelyPdf = isLikelyPdfUrl(resolvedUrl);
  let pdfData;
  try {
    pdfData = await extractPdfViaOffscreen(resolvedUrl, likelyPdf);
  } catch (_error) {
    pdfData = await extractPdfFromUrl(resolvedUrl, {
      allowUnknownContentType: likelyPdf,
      disableWorker: true
    });
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
      selectedText: selectedText || "",
      documentTextParts: pdfData.documentTextParts,
      comment: comment || ""
    },
    diagnostics: {
      missingFields: ["publishedAt"]
    }
  });

  const { fileName, record: savedRecord } = await saveRecord(record);
  return { fileName, record: savedRecord };
}

async function notifySaved(tabId, record, fileName) {
  if (!tabId) {
    return;
  }

  const payload = {
    captureType: record.captureType,
    title: record.source?.title || null,
    selectedText: record.content?.selectedText ?? null,
    comment: record.content?.comment ?? null,
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

async function handleSelectionSave(tabId, selectionOverride = "") {
  const capture = await captureFromTab(tabId, "CAPTURE_SELECTION");
  if (!capture?.ok) {
    if (capture?.missingReceiver) {
      return handlePdfCapture(tabId, null, selectionOverride);
    }
    throw new Error(capture?.error || "Failed to capture selection");
  }
  if (capture?.isPdf) {
    const fallbackSelection =
      selectionOverride && selectionOverride.trim()
        ? selectionOverride
        : capture.selectedText && capture.selectedText.trim()
          ? capture.selectedText
          : await readSelectionFromPage(tabId);
    let resolvedSelection = fallbackSelection;
    if (!resolvedSelection) {
      const copied = await copySelectionFromPage(tabId);
      if (copied) {
        resolvedSelection = await readClipboardTextViaOffscreen();
      }
    }
    return handlePdfCapture(tabId, null, resolvedSelection);
  }

  const record = buildCaptureRecord({
    captureType: "selected_text",
    source: capture.source,
    content: {
      selectedText: capture.selectedText ?? "",
      documentText: capture.documentText,
      comment: null
    },
    diagnostics: capture.diagnostics
  });

  const { fileName, record: savedRecord } = await saveRecord(record);
  return { fileName, record: savedRecord };
}

async function handleSelectionSaveWithComment(tabId, selectionOverride = "") {
  const capture = await captureFromTab(tabId, "CAPTURE_SELECTION_WITH_COMMENT");
  if (!capture?.ok) {
    if (capture?.missingReceiver) {
      const comment = await requestCommentFromExtension();
      if (comment === null) {
        throw new Error("Comment cancelled");
      }
      return handlePdfCapture(tabId, comment, selectionOverride);
    }
    throw new Error(capture?.error || "Failed to capture selection");
  }
  if (capture?.isPdf) {
    const fallbackSelection =
      selectionOverride && selectionOverride.trim()
        ? selectionOverride
        : capture.selectedText && capture.selectedText.trim()
          ? capture.selectedText
          : await readSelectionFromPage(tabId);
    let resolvedSelection = fallbackSelection;
    if (!resolvedSelection) {
      const copied = await copySelectionFromPage(tabId);
      if (copied) {
        resolvedSelection = await readClipboardTextViaOffscreen();
      }
    }
    return handlePdfCapture(tabId, capture.comment ?? "", resolvedSelection);
  }

  const record = buildCaptureRecord({
    captureType: "selected_text",
    source: capture.source,
    content: {
      selectedText: capture.selectedText ?? "",
      documentText: capture.documentText,
      comment: capture.comment ?? ""
    },
    diagnostics: capture.diagnostics
  });

  const { fileName, record: savedRecord } = await saveRecord(record);
  return { fileName, record: savedRecord };
}

async function handleYouTubeTranscriptSave(tabId) {
  const capture = await captureFromTab(tabId, "CAPTURE_YOUTUBE_TRANSCRIPT");
  if (!capture?.ok) {
    throw new Error(capture?.error || "Failed to capture YouTube transcript");
  }

  const record = buildCaptureRecord({
    captureType: "youtube_transcript",
    source: capture.source,
    content: {
      documentText: capture.documentText,
      transcriptText: capture.transcriptText,
      transcriptSegments: capture.transcriptSegments
    },
    diagnostics: capture.diagnostics
  });

  const { fileName, record: savedRecord } = await saveRecord(record);
  return { fileName, record: savedRecord };
}

async function runAction(kind, tabId, selectionOverride = "") {
  let kindLabel = "selection";
  try {
    if (kind === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
      kindLabel = "youtube_transcript";
    }
    if (kind === COMMAND_SAVE_SELECTION_WITH_COMMENT || kind === MENU_SAVE_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
    }

    await assertFolderAccess();
    let forceNotification = false;
    try {
      const tab = await chrome.tabs.get(tabId);
      const resolved = resolvePdfUrl(tab?.url) || tab?.url;
      forceNotification = resolved ? isLikelyPdfUrl(resolved) : false;
    } catch (_error) {
      forceNotification = false;
    }

    await notifyStart(tabId, kindLabel, forceNotification);

    if (kind === MENU_SAVE_SELECTION || kind === COMMAND_SAVE_SELECTION) {
      const { fileName, record } = await handleSelectionSave(tabId, selectionOverride);
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection", fileName });
      await notifySaved(tabId, record, fileName);
      console.info("Saved capture", fileName);
      return { ok: true, fileName };
    }

    if (kind === COMMAND_SAVE_SELECTION_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
      const { fileName, record } = await handleSelectionSaveWithComment(tabId, selectionOverride);
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection_with_comment", fileName });
      await notifySaved(tabId, record, fileName);
      console.info("Saved capture with comment", fileName);
      return { ok: true, fileName };
    }

    if (kind === MENU_SAVE_WITH_COMMENT) {
      kindLabel = "selection_with_comment";
      const { fileName, record } = await handleSelectionSaveWithComment(tabId, selectionOverride);
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "selection_with_comment", fileName });
      await notifySaved(tabId, record, fileName);
      console.info("Saved capture with comment", fileName);
      return { ok: true, fileName };
    }

    if (kind === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
      kindLabel = "youtube_transcript";
      const { fileName, record } = await handleYouTubeTranscriptSave(tabId);
      await setBadge(tabId, "OK", "#2e7d32");
      chrome.notifications.clear(START_NOTIFICATION_ID).catch(() => undefined);
      await setLastCaptureStatus({ ok: true, kind: "youtube_transcript", fileName });
      await notifySaved(tabId, record, fileName);
      console.info("Saved capture", fileName);
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
  createMenus().catch((error) => console.error("Failed to create context menus", error));
});

chrome.runtime.onStartup.addListener(() => {
  createMenus().catch((error) => console.error("Failed to create context menus", error));
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  if (info.menuItemId === MENU_SAVE_SELECTION) {
    runAction(MENU_SAVE_SELECTION, tab.id, info.selectionText || "").catch((error) =>
      console.error(error)
    );
    return;
  }

  if (info.menuItemId === MENU_SAVE_WITH_COMMENT) {
    runAction(MENU_SAVE_WITH_COMMENT, tab.id, info.selectionText || "").catch((error) =>
      console.error(error)
    );
    return;
  }

  if (info.menuItemId === MENU_SAVE_YOUTUBE_TRANSCRIPT) {
    runAction(MENU_SAVE_YOUTUBE_TRANSCRIPT, tab.id).catch((error) => console.error(error));
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
    runAction(COMMAND_SAVE_SELECTION, tab.id).catch((error) => console.error(error));
    return;
  }

  runAction(COMMAND_SAVE_SELECTION_WITH_COMMENT, tab.id).catch((error) => console.error(error));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
          return runAction("COMMAND_SAVE_SELECTION", tab.id);
        }

        if (message.kind === "youtube_transcript") {
          return runAction(MENU_SAVE_YOUTUBE_TRANSCRIPT, tab.id);
        }

        throw new Error("Unknown capture type");
      })
      .then((result) => sendResponse(result || { ok: false, error: "No result" }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Capture failed" }));
    return true;
  }

  return undefined;
});
