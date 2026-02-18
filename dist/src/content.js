function normalizeText(value) {
  return (value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getMetaContent(selector) {
  /** @type {HTMLMetaElement|null} */
  const node = document.querySelector(selector);
  return node?.content?.trim() || null;
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

function showSaveToast({ captureType, title, selectedText, comment, fileName }) {
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
  } else if (selectedText && selectedText.trim().length > 0) {
    const preview = selectedText.trim().replace(/\s+/g, " ").slice(0, 160);
    lines.push(`Selected: "${preview}${selectedText.trim().length > 160 ? "..." : ""}"`);
  } else {
    lines.push("No selection. Saved full page content.");
  }

  if (comment && comment.trim().length > 0) {
    lines.push(`Comment: "${comment.trim().slice(0, 120)}${comment.trim().length > 120 ? "..." : ""}"`);
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
  `;
  document.head?.appendChild(style);
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
    heading.textContent = "Add a comment";

    const hint = document.createElement("p");
    hint.textContent = "Your note will be saved alongside this capture.";

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Optional comment about this content";

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
  const isPdf =
    (document.contentType || "").toLowerCase().includes("pdf") ||
    /\.pdf([?#]|$)/i.test(window.location.href);
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

function getYouTubeVideoId() {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith("/watch")) {
    return url.searchParams.get("v");
  }

  if (url.pathname.startsWith("/shorts/")) {
    return url.pathname.split("/")[2] || null;
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryOpenTranscriptPanel() {
  const existingRows = document.querySelectorAll("ytd-transcript-segment-renderer");
  if (existingRows.length > 0) {
    return true;
  }

  /** @type {HTMLElement|null} */
  const menuButton =
    document.querySelector('ytd-menu-renderer button[aria-label*="More actions" i]') ||
    document.querySelector('button[aria-label*="more actions" i]');

  if (!menuButton) {
    return false;
  }

  menuButton.click();
  await sleep(250);

  const menuItems = Array.from(
    document.querySelectorAll("tp-yt-paper-item, ytd-menu-service-item-renderer")
  );
  const transcriptItem = menuItems.find((item) => /show transcript/i.test(item.textContent || ""));

  if (!transcriptItem) {
    /** @type {HTMLElement|null} */
    const dismiss = document.querySelector("tp-yt-iron-dropdown[opened] tp-yt-paper-item");
    dismiss?.click();
    return false;
  }

  /** @type {HTMLElement} */ (transcriptItem).click();

  for (let i = 0; i < 10; i += 1) {
    await sleep(250);
    if (document.querySelectorAll("ytd-transcript-segment-renderer").length > 0) {
      return true;
    }
  }

  return false;
}

function extractTranscriptSegments() {
  const rows = Array.from(document.querySelectorAll("ytd-transcript-segment-renderer"));

  return rows
    .map((row) => {
      const timestamp =
        row.querySelector(".segment-timestamp")?.textContent?.trim() ||
        row.querySelector("yt-formatted-string.segment-timestamp")?.textContent?.trim() ||
        null;

      const text =
        row.querySelector(".segment-text")?.textContent?.trim() ||
        row.querySelector("yt-formatted-string.segment-text")?.textContent?.trim() ||
        null;

      if (!text) {
        return null;
      }

      return { timestamp, text };
    })
    .filter(Boolean);
}

async function captureYouTubeTranscript() {
  const page = getPageMetadata();
  const videoId = getYouTubeVideoId();

  const opened = await tryOpenTranscriptPanel();
  const segments = extractTranscriptSegments();
  const transcriptText = segments.map((item) => item.text).join("\n");

  const transcriptUnavailable = !opened || segments.length === 0;
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
    documentText: getDocumentText(),
    transcriptText: transcriptText || null,
    transcriptSegments: segments,
    source: {
      ...page,
      metadata: {
        ...page.metadata,
        videoId,
        transcriptStatus: transcriptUnavailable ? "transcript_unavailable" : "transcript_available"
      }
    },
    diagnostics: {
      missingFields,
      transcriptOpenedByExtension: opened,
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
          error: error?.message || "Failed to capture comment"
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

  sendResponse({ ok: false, error: "Unknown message type" });
});
