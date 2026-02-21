function resolveChromeLike(chromeLike) {
  if (chromeLike) {
    return chromeLike;
  }
  return /** @type {any} */ (globalThis).chrome;
}

export function supportsOffscreenApi(chromeLike = undefined) {
  const runtime = resolveChromeLike(chromeLike);
  return Boolean(runtime?.offscreen?.createDocument && runtime?.offscreen?.hasDocument);
}

export function describeRuntimeCapabilities(chromeLike = undefined) {
  return {
    offscreen: supportsOffscreenApi(resolveChromeLike(chromeLike))
  };
}

export function getClipboardFallbackGuidance() {
  return "Clipboard fallback is limited in this browser; select text directly on-page and retry.";
}

export function getPdfFallbackGuidance() {
  return "PDF offscreen extraction is unavailable; fallback extraction will be used when possible.";
}
