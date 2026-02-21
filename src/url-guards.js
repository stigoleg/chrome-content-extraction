function normalizeUrlInput(rawUrl) {
  if (rawUrl === undefined || rawUrl === null) {
    return "";
  }
  return String(rawUrl).trim();
}

function isAllowedYouTubeFetchHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "googlevideo.com" || host.endsWith(".googlevideo.com");
}

export function assertAllowedYouTubeFetchUrl(rawUrl) {
  const value = normalizeUrlInput(rawUrl);
  if (!value) {
    throw new Error("Missing fetch URL.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error("Invalid fetch URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Blocked fetch URL: only HTTPS is allowed.");
  }

  if (!isAllowedYouTubeFetchHost(parsed.hostname)) {
    throw new Error("Blocked fetch URL: host is not allowed.");
  }

  return parsed.toString();
}

export function isAllowedYouTubeFetchUrl(rawUrl) {
  try {
    assertAllowedYouTubeFetchUrl(rawUrl);
    return true;
  } catch (_error) {
    return false;
  }
}
