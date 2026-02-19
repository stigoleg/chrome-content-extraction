function normalizeText(value) {
  return (value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getMetaContent(selector) {
  /** @type {HTMLMetaElement|null} */
  const node = document.querySelector(selector);
  return node?.content?.trim() || null;
}

function isYouTubePage() {
  return Boolean(getYouTubeVideoId());
}

function looksLikePdfUrl(rawUrl, depth = 0) {
  if (!rawUrl) {
    return false;
  }
  if (depth > 3) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl, window.location.href);
    if (/\.pdf([?#]|$)/i.test(parsed.pathname)) {
      return true;
    }

    const candidates = [
      parsed.searchParams.get("file"),
      parsed.searchParams.get("src"),
      parsed.searchParams.get("url"),
      parsed.searchParams.get("doc")
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        if (looksLikePdfUrl(decodeURIComponent(candidate), depth + 1)) {
          return true;
        }
      } catch (_error) {
        if (looksLikePdfUrl(candidate, depth + 1)) {
          return true;
        }
      }
    }

    return /\.pdf([?#]|$)/i.test(parsed.hash || "");
  } catch (_error) {
    return /\.pdf([?#]|$)/i.test(String(rawUrl));
  }
}

function isPdfPage() {
  const type = (document.contentType || "").toLowerCase();
  if (type.includes("pdf")) {
    return true;
  }
  if (looksLikePdfUrl(window.location.href)) {
    return true;
  }
  const embeddedPdf = document.querySelector(
    'embed[type*="pdf"], object[type*="pdf"], iframe[src*=".pdf"], iframe[src*="file="], iframe[src*="src="]'
  );
  return Boolean(embeddedPdf);
}

function getMetaByName(name) {
  return getMetaContent(`meta[name="${name}"]`);
}

function getMetaByProperty(property) {
  return getMetaContent(`meta[property="${property}"]`);
}

function getAllMetaByProperty(property) {
  return Array.from(document.querySelectorAll(`meta[property="${property}"]`))
    .map((node) => /** @type {HTMLMetaElement} */ (node)?.content?.trim())
    .filter(Boolean);
}

function parseJsonLdPublishedDate() {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

  for (const script of scripts) {
    try {
      const raw = script.textContent?.trim();
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw);
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (stack.length > 0) {
        const item = stack.pop();
        if (!item || typeof item !== "object") {
          continue;
        }

        if (item.datePublished) {
          return String(item.datePublished);
        }

        if (item.uploadDate) {
          return String(item.uploadDate);
        }

        if (Array.isArray(item["@graph"])) {
          stack.push(...item["@graph"]);
        }
      }
    } catch (_err) {
      continue;
    }
  }

  return null;
}

function getPublishedAt() {
  const candidates = [
    getMetaContent('meta[property="article:published_time"]'),
    getMetaContent('meta[name="article:published_time"]'),
    getMetaContent('meta[name="pubdate"]'),
    getMetaContent('meta[name="publish-date"]'),
    getMetaContent('meta[itemprop="datePublished"]'),
    parseJsonLdPublishedDate(),
    document.querySelector("time[datetime]")?.getAttribute("datetime") || null
  ];

  for (const value of candidates) {
    if (!value) {
      continue;
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function deriveTitleFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const fileParam = parsed.searchParams.get("file");
    const candidate = fileParam ? decodeURIComponent(fileParam) : rawUrl;
    const inner = new URL(candidate, rawUrl);
    const segment = inner.pathname.split("/").filter(Boolean).pop();
    return segment || inner.hostname || null;
  } catch (_error) {
    return null;
  }
}

function getPageMetadata() {
  /** @type {HTMLLinkElement|null} */
  const canonicalNode = document.querySelector('link[rel="canonical"]');
  /** @type {HTMLLinkElement|null} */
  const ampNode = document.querySelector('link[rel="amphtml"]');
  /** @type {HTMLLinkElement|null} */
  const iconNode = document.querySelector('link[rel="icon"]');
  /** @type {HTMLLinkElement|null} */
  const shortcutIconNode = document.querySelector('link[rel="shortcut icon"]');

  const canonicalUrl = canonicalNode?.href || null;
  const ampUrl = ampNode?.href || null;
  const favicon =
    iconNode?.href ||
    shortcutIconNode?.href ||
    null;

  const description =
    getMetaByName("description") ||
    getMetaByProperty("og:description") ||
    getMetaByName("twitter:description");

  const author = getMetaByName("author") || getMetaByProperty("article:author");
  const keywordsRaw = getMetaByName("keywords");
  const ogTitle = getMetaByProperty("og:title");
  const siteName = getMetaByProperty("og:site_name");
  const twitterTitle = getMetaByName("twitter:title");
  const articlePublishedTime = getMetaByProperty("article:published_time");
  const articleModifiedTime = getMetaByProperty("article:modified_time");
  const articleSection = getMetaByProperty("article:section");
  const articleTags = getAllMetaByProperty("article:tag");
  const contentLanguage = getMetaContent('meta[http-equiv="content-language"]');
  const resolvedTitle =
    (document.title && document.title.trim()) ||
    ogTitle ||
    twitterTitle ||
    deriveTitleFromUrl(window.location.href) ||
    "Untitled";

  const keywords = keywordsRaw
    ? keywordsRaw
        .split(/[,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : null;

  return {
    url: window.location.href,
    title: resolvedTitle,
    site: window.location.hostname || null,
    language: document.documentElement.lang || null,
    publishedAt: getPublishedAt(),
    metadata: {
      canonicalUrl,
      description,
      author,
      keywords,
      siteName,
      articlePublishedTime,
      articleModifiedTime,
      articleSection,
      articleTags: articleTags.length ? articleTags : null,
      contentLanguage,
      documentContentType: document.contentType || null
    }
  };
}

function getDocumentText() {
  return normalizeText(document.body?.innerText || "");
}

const TOAST_STYLE_ID = "ccs-toast-style";
const TOAST_ID = "ccs-toast";
const COMMENT_STYLE_ID = "ccs-comment-style";
const COMMENT_OVERLAY_ID = "ccs-comment-overlay";
const NOTES_PANEL_ID = "ccs-notes-panel";
const NOTES_COUNT_ID = "ccs-notes-count";
const SELECTION_BUBBLE_ID = "ccs-selection-bubble";

function ensureToastStyles() {
  if (document.getElementById(TOAST_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    .ccs-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      max-width: 360px;
      background: #152238;
      color: #f8fafc;
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
      z-index: 2147483647;
      display: grid;
      gap: 6px;
    }

    .ccs-toast__title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.2px;
    }

    .ccs-toast__detail {
      color: #d5dfef;
      font-size: 12px;
      word-break: break-word;
      white-space: pre-wrap;
    }
  `;
  document.head?.appendChild(style);
}

function showSaveToast({ captureType, title, annotationCount, lastAnnotation, fileName }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent =
    captureType === "youtube_transcript" ? "Saved YouTube transcript" : "Saved page content";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";

  const lines = [];
  if (title) {
    lines.push(`Title: ${title}`);
  }

  if (captureType === "youtube_transcript") {
    lines.push("Transcript extracted from this page.");
  } else if (annotationCount && annotationCount > 0) {
    lines.push(`Highlights: ${annotationCount}`);
    if (lastAnnotation?.selectedText) {
      const preview = lastAnnotation.selectedText.trim().replace(/\s+/g, " ").slice(0, 160);
      lines.push(`Selected: "${preview}${lastAnnotation.selectedText.trim().length > 160 ? "..." : ""}"`);
    }
    if (lastAnnotation?.comment) {
      lines.push(
        `Note: "${lastAnnotation.comment.trim().slice(0, 120)}${
          lastAnnotation.comment.trim().length > 120 ? "..." : ""
        }"`
      );
    }
  } else {
    lines.push("No highlights. Saved full page content.");
  }

  if (fileName) {
    lines.push(`File: ${fileName}`);
  }

  detailEl.textContent = lines.join("\n");

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function showProgressToast({ title, detail }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#1d2f4f";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = title || "Capturing...";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = detail || "Working...";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2200);
}

function showErrorToast(message) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#5f1b1b";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = "Capture failed";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = message || "Unknown error";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function showInfoToast({ title, detail }) {
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "ccs-toast";
  toast.style.background = "#1c3b2b";

  const titleEl = document.createElement("div");
  titleEl.className = "ccs-toast__title";
  titleEl.textContent = title || "Info";

  const detailEl = document.createElement("div");
  detailEl.className = "ccs-toast__detail";
  detailEl.textContent = detail || "";

  toast.append(titleEl, detailEl);
  document.body?.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 2200);
}

function ensureCommentStyles() {
  if (document.getElementById(COMMENT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = COMMENT_STYLE_ID;
  style.textContent = `
    .ccs-comment-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 16, 28, 0.58);
      display: grid;
      place-items: center;
      z-index: 2147483647;
      font: 14px/1.4 "Segoe UI", Arial, sans-serif;
    }

    .ccs-comment-panel {
      width: min(420px, calc(100vw - 32px));
      background: #f8fafc;
      color: #0f172a;
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
      display: grid;
      gap: 10px;
    }

    .ccs-comment-panel h2 {
      margin: 0;
      font-size: 16px;
    }

    .ccs-comment-panel p {
      margin: 0;
      color: #475569;
      font-size: 12px;
    }

    .ccs-comment-panel textarea {
      width: 100%;
      min-height: 110px;
      border: 1px solid #cbd5f5;
      border-radius: 10px;
      padding: 10px;
      font: inherit;
      resize: vertical;
    }

    .ccs-comment-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .ccs-comment-actions button {
      border: 0;
      border-radius: 10px;
      padding: 8px 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .ccs-comment-actions .primary {
      background: #1d4ed8;
      color: #fff;
    }

    .ccs-comment-actions .ghost {
      background: #e2e8f0;
      color: #0f172a;
    }

    .ccs-notes-panel {
      position: fixed;
      right: 18px;
      bottom: 88px;
      background: #0f172a;
      color: #f8fafc;
      border-radius: 14px;
      padding: 12px 14px;
      display: grid;
      gap: 8px;
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.3);
      z-index: 2147483646;
    }

    .ccs-notes-panel__count {
      font-weight: 700;
      font-size: 13px;
    }

    .ccs-notes-panel__actions {
      display: flex;
      gap: 8px;
    }

    .ccs-notes-panel__actions button {
      border: 0;
      border-radius: 10px;
      padding: 8px 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .ccs-notes-panel__actions .primary {
      background: #38bdf8;
      color: #0f172a;
    }

    .ccs-selection-bubble {
      position: fixed;
      background: #0f172a;
      color: #f8fafc;
      border-radius: 999px;
      padding: 6px 10px;
      display: flex;
      gap: 8px;
      align-items: center;
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
      font: 12px/1 "Segoe UI", Arial, sans-serif;
      z-index: 2147483646;
      transform: translate(-50%, -100%);
      pointer-events: auto;
    }

    .ccs-selection-bubble button {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 999px;
    }

    .ccs-selection-bubble button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  `;
  document.head?.appendChild(style);
}

function ensureNotesPanel() {
  let panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) {
    return panel;
  }

  ensureCommentStyles();

  panel = document.createElement("div");
  panel.id = NOTES_PANEL_ID;
  panel.className = "ccs-notes-panel";

  const count = document.createElement("div");
  count.id = NOTES_COUNT_ID;
  count.className = "ccs-notes-panel__count";
  count.textContent = "Highlights ready";

  const actions = document.createElement("div");
  actions.className = "ccs-notes-panel__actions";

  const saveButton = document.createElement("button");
  saveButton.className = "primary";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      const response = await chrome.runtime.sendMessage({ type: "RUN_CAPTURE", kind: "selection" });
      if (!response?.ok) {
        showErrorToast(response?.error || "Capture failed");
      }
    } catch (error) {
      showErrorToast(error?.message || "Capture failed");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  });

  actions.append(saveButton);
  panel.append(count, actions);
  document.body?.appendChild(panel);
  return panel;
}

function updateNotesPanel(count) {
  if (!count || count <= 0) {
    const panel = document.getElementById(NOTES_PANEL_ID);
    panel?.remove();
    return;
  }

  const panel = ensureNotesPanel();
  const countEl = document.getElementById(NOTES_COUNT_ID);
  if (countEl) {
    countEl.textContent = `${count} highlight${count === 1 ? "" : "s"} ready`;
  }
  panel.style.display = "grid";
}

function clearNotesPanel() {
  const panel = document.getElementById(NOTES_PANEL_ID);
  panel?.remove();
}

function ensureSelectionBubble() {
  let bubble = document.getElementById(SELECTION_BUBBLE_ID);
  if (bubble) {
    return bubble;
  }

  ensureCommentStyles();

  bubble = document.createElement("div");
  bubble.id = SELECTION_BUBBLE_ID;
  bubble.className = "ccs-selection-bubble";

  const addNoteButton = document.createElement("button");
  addNoteButton.type = "button";
  addNoteButton.textContent = "Add highlight";

  const addCommentButton = document.createElement("button");
  addCommentButton.type = "button";
  addCommentButton.textContent = "Add highlight and note";

  bubble.append(addNoteButton, addCommentButton);
  bubble.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  addNoteButton.addEventListener("click", async () => {
    let text = normalizeText(bubble.dataset.selectionText || "");
    if (!text && isPdfPage()) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "RESOLVE_PDF_SELECTION",
          allowClipboardCopy: true
        });
        if (response?.ok) {
          text = normalizeText(response.selectedText || "");
          if (text) {
            bubble.dataset.selectionText = text;
          }
        }
      } catch (_error) {
        text = "";
      }
    }
    if (!text.trim()) {
      showErrorToast("Select text in the PDF first.");
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ADD_NOTE",
        selectedText: text,
        comment: null
      });
      if (response?.ok) {
        updateNotesPanel(response.count || 0);
        showInfoToast({ title: "Highlight added", detail: "Selection queued for saving." });
      } else {
        showErrorToast(response?.error || "Failed to add note");
      }
    } catch (error) {
      showErrorToast(error?.message || "Failed to add note");
    } finally {
      bubble.remove();
    }
  });

  addCommentButton.addEventListener("click", async () => {
    let text = normalizeText(bubble.dataset.selectionText || "");
    if (!text && isPdfPage()) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "RESOLVE_PDF_SELECTION",
          allowClipboardCopy: true
        });
        if (response?.ok) {
          text = normalizeText(response.selectedText || "");
          if (text) {
            bubble.dataset.selectionText = text;
          }
        }
      } catch (_error) {
        text = "";
      }
    }
    if (!text.trim()) {
      showErrorToast("Select text in the PDF first.");
      return;
    }
    const comment = await requestComment();
    if (comment === null) {
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "ADD_NOTE",
        selectedText: text,
        comment
      });
      if (response?.ok) {
        updateNotesPanel(response.count || 0);
        showInfoToast({ title: "Highlight added", detail: "Note queued for saving." });
      } else {
        showErrorToast(response?.error || "Failed to add note");
      }
    } catch (error) {
      showErrorToast(error?.message || "Failed to add note");
    } finally {
      bubble.remove();
    }
  });

  document.body?.appendChild(bubble);
  return bubble;
}

function hideSelectionBubble() {
  const bubble = document.getElementById(SELECTION_BUBBLE_ID);
  bubble?.remove();
}

let selectionBubbleTimer = null;
const lastPointerPosition = { x: 0, y: 0, has: false };
let pdfResolveInFlight = false;
let pdfResolveQueued = false;
let pdfSelectionPollTimer = null;
let pdfEmptyBubbleTimer = null;

function positionPdfBubble(bubble) {
  const left = lastPointerPosition.has
    ? Math.min(Math.max(lastPointerPosition.x, 16), window.innerWidth - 16)
    : Math.min(window.innerWidth - 24, Math.max(window.innerWidth / 2, 16));
  const top = lastPointerPosition.has
    ? Math.min(Math.max(lastPointerPosition.y, 24), window.innerHeight - 24)
    : Math.min(window.innerHeight - 24, Math.max(window.innerHeight / 2, 24));
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

function clearPdfEmptyBubbleTimer() {
  if (pdfEmptyBubbleTimer) {
    window.clearTimeout(pdfEmptyBubbleTimer);
    pdfEmptyBubbleTimer = null;
  }
}

function showPdfSelectionBubble(selectionText = "", options = {}) {
  const bubble = ensureSelectionBubble();
  const normalized = normalizeText(selectionText || "");
  bubble.dataset.selectionText = normalized;
  positionPdfBubble(bubble);
  clearPdfEmptyBubbleTimer();
  if (!normalized && options.ephemeral) {
    pdfEmptyBubbleTimer = window.setTimeout(() => {
      const currentBubble = document.getElementById(SELECTION_BUBBLE_ID);
      if (!currentBubble) {
        return;
      }
      const currentText = normalizeText(currentBubble.dataset.selectionText || "");
      if (!currentText) {
        hideSelectionBubble();
      }
    }, 1100);
  }
}

async function resolvePdfSelectionForBubble(options = {}) {
  if (!isPdfPage()) {
    return "";
  }

  if (pdfResolveInFlight) {
    pdfResolveQueued = true;
    return "";
  }

  pdfResolveInFlight = true;
  try {
    let text = normalizeText(window.getSelection()?.toString() || "");
    if (!text) {
      const response = await chrome.runtime.sendMessage({
        type: "RESOLVE_PDF_SELECTION",
        allowClipboardCopy: options.allowClipboardCopy === true
      });
      if (response?.ok) {
        text = normalizeText(response.selectedText || "");
      }
    }

    if (text) {
      showPdfSelectionBubble(text);
      return text;
    }

    if (options.allowEmptyBubble) {
      showPdfSelectionBubble("", { ephemeral: true });
      return "";
    }

    const bubble = document.getElementById(SELECTION_BUBBLE_ID);
    if (bubble && !normalizeText(bubble.dataset.selectionText || "")) {
      hideSelectionBubble();
    }
    return "";
  } catch (_error) {
    return "";
  } finally {
    pdfResolveInFlight = false;
    if (pdfResolveQueued) {
      pdfResolveQueued = false;
      void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
    }
  }
}

function ensurePdfSelectionPoller() {
  if (!isPdfPage() || pdfSelectionPollTimer) {
    return;
  }
  pdfSelectionPollTimer = window.setInterval(() => {
    if (!isPdfPage()) {
      stopPdfSelectionPoller();
      return;
    }
    if (document.hidden) {
      return;
    }
    void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
  }, 1400);
}

function stopPdfSelectionPoller() {
  if (!pdfSelectionPollTimer) {
    return;
  }
  window.clearInterval(pdfSelectionPollTimer);
  pdfSelectionPollTimer = null;
}

function scheduleSelectionBubbleUpdate() {
  if (isYouTubePage()) {
    hideSelectionBubble();
    stopPdfSelectionPoller();
    return;
  }
  if (selectionBubbleTimer) {
    window.clearTimeout(selectionBubbleTimer);
  }

  selectionBubbleTimer = window.setTimeout(() => {
    void (async () => {
    if (isPdfPage()) {
      ensurePdfSelectionPoller();
      await resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
      return;
    }

    stopPdfSelectionPoller();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      hideSelectionBubble();
      return;
    }
    let anchor = selection.anchorNode;
    if (anchor && anchor.nodeType === Node.TEXT_NODE) {
      anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
      const inOverlay = anchor.closest(`#${COMMENT_OVERLAY_ID}`);
      const inNotes = anchor.closest(`#${NOTES_PANEL_ID}`);
      if (inOverlay || inNotes) {
        hideSelectionBubble();
        return;
      }
    }
    const text = normalizeText(selection.toString() || "");
    if (!text) {
      hideSelectionBubble();
      return;
    }
    if (!selection.rangeCount) {
      hideSelectionBubble();
      return;
    }

    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      const rects = range.getClientRects();
      if (rects.length) {
        rect = rects[0];
      }
    }
    if (!rect || (!rect.width && !rect.height)) {
      hideSelectionBubble();
      return;
    }

    const bubble = ensureSelectionBubble();
    bubble.dataset.selectionText = text;

    const left = Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16);
    const top = Math.max(rect.top - 8, 16);

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    })();
  }, 80);
}

function requestComment() {
  return new Promise((resolve) => {
    const existing = document.getElementById(COMMENT_OVERLAY_ID);
    if (existing) {
      existing.remove();
    }

    ensureCommentStyles();

    const overlay = document.createElement("div");
    overlay.id = COMMENT_OVERLAY_ID;
    overlay.className = "ccs-comment-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "ccs-comment-panel";

    const heading = document.createElement("h2");
    heading.textContent = "Add a note";

    const hint = document.createElement("p");
    hint.textContent = "Your note will be saved alongside this capture.";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Optional note about this content";

    const actions = document.createElement("div");
    actions.className = "ccs-comment-actions";

    const cancelButton = document.createElement("button");
    cancelButton.className = "ghost";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";

    const saveButton = document.createElement("button");
    saveButton.className = "primary";
    saveButton.type = "button";
    saveButton.textContent = "Save";

    actions.append(cancelButton, saveButton);
    panel.append(heading, hint, textarea, actions);
    overlay.append(panel);
    document.body?.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelButton.addEventListener("click", () => cleanup(null));
    saveButton.addEventListener("click", () => cleanup(textarea.value.trim()));
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(null);
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        cleanup(textarea.value.trim());
      }
    });

    textarea.focus();
  });
}

function captureSelection() {
  const selection = normalizeText(window.getSelection()?.toString() || "");
  const page = getPageMetadata();
  const isPdf = isPdfPage();
  return {
    ok: true,
    type: "selected_text",
    isPdf,
    selectedText: selection,
    documentText: isPdf ? null : getDocumentText(),
    source: {
      ...page,
      metadata: {
        ...page.metadata,
        selectionLength: selection.length
      }
    },
    diagnostics: {
      missingFields: page.publishedAt ? [] : ["publishedAt"]
    }
  };
}

document.addEventListener("selectionchange", scheduleSelectionBubbleUpdate);
async function handleSelectionPointerEvent(event) {
  lastPointerPosition.x = event.clientX;
  lastPointerPosition.y = event.clientY;
  lastPointerPosition.has = true;
  if (isPdfPage()) {
    ensurePdfSelectionPoller();
    await resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: true });
    return;
  }
  scheduleSelectionBubbleUpdate();
}

document.addEventListener("mouseup", handleSelectionPointerEvent);
window.addEventListener("mouseup", handleSelectionPointerEvent, true);
document.addEventListener("pointerup", handleSelectionPointerEvent, true);
window.addEventListener("pointerup", handleSelectionPointerEvent, true);
document.addEventListener("keyup", scheduleSelectionBubbleUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hideSelectionBubble();
    return;
  }
  if (isPdfPage()) {
    ensurePdfSelectionPoller();
    void resolvePdfSelectionForBubble({ allowClipboardCopy: false, allowEmptyBubble: false });
  }
});
window.addEventListener(
  "scroll",
  () => {
    hideSelectionBubble();
  },
  true
);

if (isPdfPage()) {
  ensurePdfSelectionPoller();
}

function getYouTubeVideoId() {
  try {
    const url = new URL(window.location.href);
    const hostname = (url.hostname || "").toLowerCase();

    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (!(hostname === "youtube.com" || hostname.endsWith(".youtube.com"))) {
      return null;
    }

    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }

    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/")[2] || null;
    }

    if (url.pathname.startsWith("/live/")) {
      return url.pathname.split("/")[2] || null;
    }

    if (url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/")[2] || null;
    }

    return null;
  } catch (_error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeTimestamp(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || null;
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

function normalizeTranscriptSegments(rawSegments) {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return [];
  }

  const normalized = rawSegments
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
    const key = transcriptSegmentKey(segment);
    if (key === previousKey) {
      continue;
    }
    adjacentDeduped.push(segment);
    previousKey = key;
  }

  return collapseRepeatedTranscriptSequence(adjacentDeduped);
}

function transcriptTextFromSegments(segments) {
  return segments.map((segment) => segment.text).join("\n");
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let start = -1;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function findJsonInText(text, marker) {
  let idx = text.indexOf(marker);
  while (idx !== -1) {
    const start = text.indexOf("{", idx);
    if (start === -1) {
      return null;
    }
    const jsonText = extractBalancedJson(text, start);
    if (!jsonText) {
      return null;
    }
    try {
      return JSON.parse(jsonText);
    } catch (_error) {
      idx = text.indexOf(marker, idx + marker.length);
    }
  }
  return null;
}

function findPlayerResponseInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytInitialPlayerResponse")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytInitialPlayerResponse");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

async function fetchPlayerResponseFromHtml() {
  try {
    const response = await fetch(window.location.href, { credentials: "include" });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    return findJsonInText(text, "ytInitialPlayerResponse");
  } catch (_error) {
    return null;
  }
}

async function getPlayerResponseFromMainWorld() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_YT_PLAYER_RESPONSE" });
    if (response?.ok && response.playerResponse) {
      return response.playerResponse;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

async function getPlayerResponse() {
  const fromMain = await getPlayerResponseFromMainWorld();
  if (fromMain) {
    return fromMain;
  }

  const fromScripts = findPlayerResponseInScripts();
  if (fromScripts) {
    return fromScripts;
  }
  return fetchPlayerResponseFromHtml();
}

function getCaptionTracks(playerResponse) {
  const captions =
    playerResponse?.captions?.playerCaptionsTracklistRenderer ||
    playerResponse?.captions?.playerCaptionsRenderer ||
    playerResponse?.playerCaptionsTracklistRenderer ||
    playerResponse?.playerCaptionsRenderer ||
    null;
  return captions?.captionTracks || null;
}

function isAutoGeneratedTrack(track) {
  if (!track) {
    return false;
  }
  if (track.kind === "asr") {
    return true;
  }
  const label = track.name?.simpleText || track.name?.runs?.map((run) => run?.text).join("") || "";
  return /auto-generated|auto generated|automatically/i.test(label);
}

function buildPreferredLanguages() {
  const preferred = [];
  const add = (value) => {
    const normalized = String(value || "").replace("_", "-").trim();
    if (!normalized) {
      return;
    }
    const lower = normalized.toLowerCase();
    if (!preferred.includes(lower)) {
      preferred.push(lower);
    }
    const base = lower.split("-")[0];
    if (base && !preferred.includes(base)) {
      preferred.push(base);
    }
  };

  add("en-US");
  add("en");
  const navLang = navigator.language || "";
  add(navLang);
  if (Array.isArray(navigator.languages)) {
    navigator.languages.forEach(add);
  }

  return preferred;
}

function pickCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const preferred = buildPreferredLanguages();
  for (const lang of preferred) {
    const exact = tracks.find(
      (track) =>
        track.languageCode?.toLowerCase().startsWith(lang) && !isAutoGeneratedTrack(track)
    );
    if (exact) {
      return exact;
    }
  }
  for (const lang of preferred) {
    const fallback = tracks.find((track) => track.languageCode?.toLowerCase().startsWith(lang));
    if (fallback) {
      return fallback;
    }
  }

  const nonAuto = tracks.find((track) => !isAutoGeneratedTrack(track));
  return nonAuto || tracks[0];
}

async function fetchTimedTextTracks(videoId) {
  if (!videoId) {
    return null;
  }
  try {
    const url = `https://www.youtube.com/api/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
    let text = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        text = await response.text();
      }
    } catch (_error) {
      text = null;
    }
    if (!text) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_TEXT", url });
      if (fallback?.ok) {
        text = fallback.text;
      }
    }
    if (!text) {
      return null;
    }
    if (!text || !text.includes("<track")) {
      return null;
    }
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const tracks = Array.from(doc.querySelectorAll("track")).map((track) => ({
      lang: track.getAttribute("lang_code"),
      kind: track.getAttribute("kind"),
      name: track.getAttribute("name"),
      langOriginal: track.getAttribute("lang_original"),
      langTranslated: track.getAttribute("lang_translated")
    }));
    return tracks.filter((track) => track.lang);
  } catch (_error) {
    return null;
  }
}

function pickTimedTextTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  const preferred = buildPreferredLanguages();
  for (const lang of preferred) {
    const exact = tracks.find(
      (track) => track.lang?.toLowerCase().startsWith(lang) && track.kind !== "asr"
    );
    if (exact) {
      return exact;
    }
  }
  for (const lang of preferred) {
    const fallback = tracks.find((track) => track.lang?.toLowerCase().startsWith(lang));
    if (fallback) {
      return fallback;
    }
  }

  const nonAuto = tracks.find((track) => track.kind !== "asr");
  return nonAuto || tracks[0];
}

async function fetchTranscriptViaTimedText(videoId) {
  const tracks = await fetchTimedTextTracks(videoId);
  const track = pickTimedTextTrack(tracks);
  if (!track?.lang) {
    return null;
  }

  const params = new URLSearchParams({
    v: videoId,
    lang: track.lang,
    fmt: "json3"
  });
  if (track.kind) {
    params.set("kind", track.kind);
  }

  try {
    const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
    let data = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        data = await response.json();
      }
    } catch (_error) {
      data = null;
    }
    if (!data) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_JSON", url });
      if (fallback?.ok) {
        data = fallback.json;
      }
    }
    if (!data) {
      return null;
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const segments = normalizeTranscriptSegments(
      events
      .map((event) => {
        const text = normalizeText(
          (event?.segs || []).map((seg) => seg?.utf8 || "").join("")
        );
        if (!text) {
          return null;
        }
        return {
          timestamp: formatTimestamp(Number(event?.tStartMs || 0)),
          text
        };
      })
      .filter(Boolean)
    );

    if (!segments.length) {
      return null;
    }

    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments),
      track
    };
  } catch (_error) {
    return null;
  }
}

async function fetchTranscriptFromTrack(track) {
  if (!track?.baseUrl) {
    return null;
  }
  let url = track.baseUrl;
  if (!/[?&]fmt=/.test(url)) {
    url += `${url.includes("?") ? "&" : "?"}fmt=json3`;
  }

  try {
    let data = null;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        data = await response.json();
      }
    } catch (_error) {
      data = null;
    }
    if (!data) {
      const fallback = await chrome.runtime.sendMessage({ type: "YT_FETCH_JSON", url });
      if (fallback?.ok) {
        data = fallback.json;
      }
    }
    if (!data) {
      return null;
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const segments = normalizeTranscriptSegments(
      events
      .map((event) => {
        const text = normalizeText(
          (event?.segs || []).map((seg) => seg?.utf8 || "").join("")
        );
        if (!text) {
          return null;
        }
        return {
          timestamp: formatTimestamp(Number(event?.tStartMs || 0)),
          text
        };
      })
      .filter(Boolean)
    );

    if (!segments.length) {
      return null;
    }

    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments)
    };
  } catch (_error) {
    return null;
  }
}

async function fetchTranscriptViaApi() {
  const playerResponse = await getPlayerResponse();
  if (playerResponse) {
    const tracks = getCaptionTracks(playerResponse);
    const track = pickCaptionTrack(tracks);
    if (track) {
      const transcript = await fetchTranscriptFromTrack(track);
      if (transcript) {
        return {
          ...transcript,
          track,
          source: "api"
        };
      }
    }
  }

  return null;
}

const YT_TRANSCRIPT_PANEL_TARGET_ID = "engagement-panel-searchable-transcript";

function getTranscriptRows() {
  const scopedPanels = Array.from(
    document.querySelectorAll(
      `ytd-engagement-panel-section-list-renderer[target-id="${YT_TRANSCRIPT_PANEL_TARGET_ID}"], ` +
        `ytd-engagement-panel-section-list-renderer[panel-identifier="${YT_TRANSCRIPT_PANEL_TARGET_ID}"]`
    )
  );

  const scopedRows = scopedPanels.flatMap((panel) =>
    Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer"))
  );
  if (scopedRows.length > 0) {
    return scopedRows;
  }

  return Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));
}

async function waitForTranscriptRows(maxAttempts = 24, delayMs = 250) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (getTranscriptRows().length > 0) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

function hasTranscriptKeyword(text) {
  const value = String(text || "").toLowerCase();
  return /(transcript|transkrips|transkrip|caption|subtit|untertitel|sous-?titres)/i.test(value);
}

function deepFindInObject(root, predicate) {
  if (!root || typeof root !== "object") {
    return null;
  }

  const stack = [root];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (predicate(current)) {
      return current;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    for (const key of Object.keys(current)) {
      stack.push(current[key]);
    }
  }

  return null;
}

function hasTranscriptCommandData(element) {
  if (!element) {
    return false;
  }
  const anyElement = /** @type {any} */ (element);
  const roots = [
    anyElement.data,
    anyElement.__data,
    anyElement.__dataHost?.data,
    anyElement.__dataHost?.__data
  ];

  for (const root of roots) {
    const found = deepFindInObject(
      root,
      (node) =>
        node?.changeEngagementPanelVisibilityAction?.targetId === YT_TRANSCRIPT_PANEL_TARGET_ID ||
        typeof node?.getTranscriptEndpoint?.params === "string"
    );
    if (found) {
      return true;
    }
  }

  return false;
}

function executeYouTubeCommand(command) {
  if (!command || typeof command !== "object") {
    return false;
  }

  const targets = [
    document.querySelector("ytd-watch-flexy"),
    document.querySelector("ytd-app"),
    document.querySelector("ytd-page-manager")
  ];

  for (const target of targets) {
    const anyTarget = /** @type {any} */ (target);
    if (!anyTarget) {
      continue;
    }
    try {
      if (typeof anyTarget.resolveCommand === "function") {
        anyTarget.resolveCommand(command);
        return true;
      }
      if (typeof anyTarget.handleCommand === "function") {
        anyTarget.handleCommand(command);
        return true;
      }
    } catch (_error) {
      continue;
    }
  }

  return false;
}

function findInitialDataInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytInitialData")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytInitialData");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function findYtcfgInScripts() {
  const scripts = Array.from(document.scripts || []);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytcfg.set(")) {
      continue;
    }
    const parsed = findJsonInText(text, "ytcfg.set");
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function findTranscriptInnertubeCommand(initialData) {
  return deepFindInObject(
    initialData,
    (node) =>
      typeof node?.getTranscriptEndpoint?.params === "string" &&
      node?.commandMetadata?.webCommandMetadata?.apiUrl === "/youtubei/v1/get_transcript"
  );
}

function parseTranscriptSegmentsFromInnerTubePayload(payload) {
  const segments = [];
  const stack = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    const renderer = current.transcriptSegmentRenderer;
    if (renderer) {
      const text = normalizeText((renderer.snippet?.runs || []).map((run) => run?.text || "").join(""));
      if (text) {
        const timestamp =
          renderer.startTimeText?.simpleText ||
          (renderer.startTimeText?.runs || []).map((run) => run?.text || "").join("").trim() ||
          null;
        segments.push({ timestamp, text });
      }
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }

    for (const key of Object.keys(current)) {
      stack.push(current[key]);
    }
  }

  return normalizeTranscriptSegments(segments);
}

async function fetchTranscriptViaInnertube() {
  const initialData = findInitialDataInScripts();
  const command = findTranscriptInnertubeCommand(initialData);
  const params = command?.getTranscriptEndpoint?.params || null;
  if (!params) {
    return null;
  }

  const ytcfg = findYtcfgInScripts() || {};
  const apiKey = ytcfg.INNERTUBE_API_KEY || null;
  if (!apiKey) {
    return null;
  }

  const context =
    ytcfg.INNERTUBE_CONTEXT || {
      client: {
        clientName: "WEB",
        clientVersion: ytcfg.INNERTUBE_CLIENT_VERSION || null,
        hl: document.documentElement.lang || "en"
      }
    };

  const headers = {
    "content-type": "application/json"
  };

  if (ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME) {
    headers["x-youtube-client-name"] = String(ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME);
  }
  if (ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION) {
    headers["x-youtube-client-version"] = String(ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION);
  }
  if (ytcfg.VISITOR_DATA || context?.client?.visitorData) {
    headers["x-goog-visitor-id"] = String(ytcfg.VISITOR_DATA || context.client.visitorData);
  }

  try {
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ context, params })
      }
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const segments = parseTranscriptSegmentsFromInnerTubePayload(payload);
    if (!segments.length) {
      return null;
    }
    return {
      segments,
      transcriptText: transcriptTextFromSegments(segments),
      source: "innertube"
    };
  } catch (_error) {
    return null;
  }
}

async function tryOpenTranscriptPanel() {
  if (getTranscriptRows().length > 0) {
    return true;
  }

  const openCommand = {
    changeEngagementPanelVisibilityAction: {
      targetId: YT_TRANSCRIPT_PANEL_TARGET_ID,
      visibility: "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"
    }
  };
  if (executeYouTubeCommand(openCommand) && (await waitForTranscriptRows(24, 250))) {
    return true;
  }

  const directTranscriptButton = Array.from(
    document.querySelectorAll(
      'button, tp-yt-paper-item, ytd-button-renderer, ytd-menu-service-item-renderer'
    )
  ).find((el) => hasTranscriptKeyword(el.textContent || "") || hasTranscriptCommandData(el));

  if (directTranscriptButton) {
    /** @type {HTMLElement} */ (directTranscriptButton).click();
    if (await waitForTranscriptRows(24, 250)) {
      return true;
    }
  }

  /** @type {HTMLElement|null} */
  const menuButton =
    document.querySelector('ytd-menu-renderer button[aria-label*="More actions" i]') ||
    document.querySelector('button[aria-label*="more actions" i]') ||
    document.querySelector("ytd-menu-renderer button");

  if (!menuButton) {
    const initialData = findInitialDataInScripts();
    const command = findTranscriptInnertubeCommand(initialData);
    if (command && executeYouTubeCommand(command) && (await waitForTranscriptRows(24, 250))) {
      return true;
    }
    return false;
  }

  menuButton.click();
  await sleep(250);

  const menuItems = Array.from(
    document.querySelectorAll("tp-yt-paper-item, ytd-menu-service-item-renderer")
  );
  const transcriptItem = menuItems.find(
    (item) => hasTranscriptKeyword(item.textContent || "") || hasTranscriptCommandData(item)
  );

  if (!transcriptItem) {
    /** @type {HTMLElement|null} */
    const dismiss = document.querySelector("tp-yt-iron-dropdown[opened] tp-yt-paper-item");
    dismiss?.click();
  } else {
    /** @type {HTMLElement} */ (transcriptItem).click();
    if (await waitForTranscriptRows(24, 250)) {
      return true;
    }
  }

  const initialData = findInitialDataInScripts();
  const command = findTranscriptInnertubeCommand(initialData);
  if (command && executeYouTubeCommand(command) && (await waitForTranscriptRows(24, 250))) {
      return true;
  }

  return false;
}

function extractTranscriptSegments() {
  const rows = getTranscriptRows();
  const rawSegments = rows
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
    .filter(Boolean);

  return normalizeTranscriptSegments(rawSegments);
}

async function captureYouTubeTranscript() {
  const page = getPageMetadata();
  const videoId = getYouTubeVideoId();

  if (!videoId) {
    const missingFields = [];
    if (!page.publishedAt) {
      missingFields.push("publishedAt");
    }
    missingFields.push("transcript");

    return {
      ok: true,
      type: "youtube_transcript",
      selectedText: null,
      documentText: "",
      transcriptText: null,
      transcriptSegments: [],
      source: {
        ...page,
        metadata: {
          ...page.metadata,
          videoId: null,
          transcriptStatus: "transcript_unavailable",
          transcriptSource: "dom",
          transcriptLanguage: null,
          transcriptIsAutoGenerated: null
        }
      },
      diagnostics: {
        missingFields,
        transcriptOpenedByExtension: false,
        transcriptSource: "dom",
        reason: "No YouTube video context found in this frame."
      }
    };
  }

  const opened = await tryOpenTranscriptPanel();
  let segments = extractTranscriptSegments();
  let transcriptText = transcriptTextFromSegments(segments);
  let transcriptSource = "dom";
  let transcriptTrack = null;
  const transcriptDebug = {
    domRowsInitialRaw: getTranscriptRows().length,
    domRowsInitial: segments.length,
    transcriptOpenedByExtension: opened,
    apiAttempted: false,
    apiSucceeded: false,
    innertubeAttempted: false,
    innertubeSucceeded: false,
    timedtextAttempted: false,
    timedtextSucceeded: false
  };

  if (segments.length === 0) {
    transcriptDebug.apiAttempted = true;
    const apiResult = await fetchTranscriptViaApi();
    if (apiResult) {
      segments = apiResult.segments;
      transcriptText = apiResult.transcriptText;
      transcriptSource = apiResult.source || "api";
      transcriptTrack = apiResult.track;
      transcriptDebug.apiSucceeded = true;
    } else {
      transcriptDebug.innertubeAttempted = true;
      const innertubeResult = await fetchTranscriptViaInnertube();
      if (innertubeResult) {
        segments = innertubeResult.segments;
        transcriptText = innertubeResult.transcriptText;
        transcriptSource = "innertube";
        transcriptDebug.innertubeSucceeded = true;
      } else if (videoId) {
        transcriptDebug.timedtextAttempted = true;
        const timedTextResult = await fetchTranscriptViaTimedText(videoId);
        if (timedTextResult) {
          segments = timedTextResult.segments;
          transcriptText = timedTextResult.transcriptText;
          transcriptSource = "timedtext";
          transcriptTrack = timedTextResult.track;
          transcriptDebug.timedtextSucceeded = true;
        } else {
          transcriptSource = "timedtext";
        }
      }
    }
  }

  const transcriptUnavailable = segments.length === 0;
  transcriptDebug.finalSegmentCount = segments.length;
  transcriptDebug.finalDocumentTextLength = transcriptText.length;
  const missingFields = [];
  if (!page.publishedAt) {
    missingFields.push("publishedAt");
  }
  if (transcriptUnavailable) {
    missingFields.push("transcript");
  }

  return {
    ok: true,
    type: "youtube_transcript",
    selectedText: null,
    documentText: transcriptText || "",
    transcriptText: transcriptText || null,
    transcriptSegments: segments,
    source: {
      ...page,
      metadata: {
        ...page.metadata,
        videoId,
        transcriptStatus: transcriptUnavailable ? "transcript_unavailable" : "transcript_available",
        transcriptSource,
        transcriptLanguage: transcriptTrack?.languageCode || transcriptTrack?.lang || null,
        transcriptIsAutoGenerated: transcriptTrack ? isAutoGeneratedTrack(transcriptTrack) : null
      }
    },
    diagnostics: {
      missingFields,
      transcriptOpenedByExtension: opened,
      transcriptSource,
      transcriptDebug,
      reason: transcriptUnavailable
        ? "Transcript panel unavailable or no transcript rows found."
        : null
    }
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_SELECTION") {
    sendResponse(captureSelection());
    return;
  }

  if (message?.type === "CAPTURE_SELECTION_WITH_COMMENT") {
    const snapshot = captureSelection();
    requestComment()
      .then((comment) => {
        if (comment === null) {
          sendResponse({ ok: false, error: "Comment cancelled" });
          return;
        }

        sendResponse({
          ...snapshot,
          comment
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture note"
        });
      });
    return true;
  }

  if (message?.type === "CAPTURE_YOUTUBE_TRANSCRIPT") {
    captureYouTubeTranscript()
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture YouTube transcript"
        });
      });
    return true;
  }

  if (message?.type === "CAPTURE_YOUTUBE_TRANSCRIPT_WITH_COMMENT") {
    requestComment()
      .then((comment) => {
        if (comment === null) {
          sendResponse({ ok: false, error: "Comment cancelled" });
          return;
        }

        return captureYouTubeTranscript().then((result) => {
          sendResponse({
            ...result,
            comment
          });
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "Failed to capture transcript"
        });
      });
    return true;
  }

  if (message?.type === "SHOW_SAVE_TOAST") {
    showSaveToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_PROGRESS_TOAST") {
    showProgressToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_ERROR_TOAST") {
    showErrorToast(message.payload?.message || "Capture failed");
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "SHOW_INFO_TOAST") {
    showInfoToast(message.payload || {});
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "NOTES_UPDATED") {
    if (isYouTubePage()) {
      clearNotesPanel();
      sendResponse({ ok: true });
      return;
    }
    updateNotesPanel(Number(message.payload?.count || 0));
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "CLEAR_PENDING_NOTES") {
    clearNotesPanel();
    sendResponse({ ok: true });
    return;
  }

  sendResponse({ ok: false, error: "Unknown message type" });
});
