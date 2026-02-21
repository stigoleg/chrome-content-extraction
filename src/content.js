function resolveRuntimeGetUrl() {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL.bind(chrome.runtime);
  }
  const browserApi = /** @type {any} */ (globalThis).browser;
  if (browserApi?.runtime?.getURL) {
    return browserApi.runtime.getURL.bind(browserApi.runtime);
  }
  return null;
}

const getUrl = resolveRuntimeGetUrl();
if (getUrl) {
  // Content scripts are loaded as classic scripts; dynamic import boots module code.
  import(getUrl("src/content-main.js")).catch((error) => {
    const globalRef = /** @type {any} */ (globalThis);
    globalRef.__CCS_CONTENT_BOOTSTRAP_ERROR__ = String(error?.message || error || "unknown");
  });
}
