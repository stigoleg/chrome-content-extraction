import { extractPdfFromUrl } from "./pdf.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_EXTRACT_PDF") {
    extractPdfFromUrl(message.url, {
      allowUnknownContentType: message.allowUnknownContentType,
      disableWorker: false
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "PDF extraction failed" });
      });

    return true;
  }

  if (message?.type === "OFFSCREEN_READ_CLIPBOARD") {
    navigator.clipboard
      .readText()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || "Clipboard read failed" });
      });
    return true;
  }

  return undefined;
});
