const statusLine = document.getElementById("statusLine");
const saveSelectionButton = document.getElementById("saveSelectionButton");
const saveTranscriptButton = document.getElementById("saveTranscriptButton");
const saveTranscriptCommentButton = document.getElementById("saveTranscriptCommentButton");
const openSettingsButton = document.getElementById("openSettingsButton");
const shortcutHint = document.getElementById("shortcutHint");

if (!navigator.userAgent.includes("Mac")) {
  shortcutHint.textContent = "Shortcuts: Ctrl+Shift+D, Ctrl+Shift+C";
}

function formatStatus(status) {
  if (!status) {
    return "No captures yet.";
  }

  const kindLabels = {
    selection: "content",
    selection_with_note: "content + note",
    youtube_transcript: "transcript",
    transcript_with_note: "transcript + note",
    selection_with_comment: "content + note"
  };
  const kindLabel = kindLabels[status.kind] || status.kind;
  const time = new Date(status.timestamp).toLocaleString();
  if (status.ok) {
    return `Last capture OK (${kindLabel}) at ${time}${
      status.fileName ? `\n${status.fileName}` : ""
    }`;
  }

  return `Last capture failed (${kindLabel}) at ${time}\n${status.error || "Unknown error"}`;
}

async function refreshStatus() {
  const response = await chrome.runtime.sendMessage({ type: "GET_LAST_CAPTURE_STATUS" });
  statusLine.textContent = formatStatus(response?.status || null);
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

async function refreshButtons() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url || "";
  const isYouTube = isYouTubeUrl(url);

  if (isYouTube) {
    saveSelectionButton.style.display = "none";
    saveTranscriptButton.style.display = "block";
    saveTranscriptCommentButton.style.display = "block";
  } else {
    saveSelectionButton.style.display = "block";
    saveTranscriptButton.style.display = "none";
    saveTranscriptCommentButton.style.display = "none";
  }
}

async function runCapture(kind) {
  statusLine.textContent = "Running capture...";
  const response = await chrome.runtime.sendMessage({ type: "RUN_CAPTURE", kind });
  if (!response?.ok) {
    statusLine.textContent = `Capture failed: ${response?.error || "Unknown error"}`;
    return;
  }

  statusLine.textContent = `Saved: ${response.fileName}`;
}

saveSelectionButton.addEventListener("click", () => {
  runCapture("selection").catch((error) => {
    statusLine.textContent = error?.message || "Capture failed";
  });
});

saveTranscriptButton.addEventListener("click", () => {
  runCapture("youtube_transcript").catch((error) => {
    statusLine.textContent = error?.message || "Capture failed";
  });
});

saveTranscriptCommentButton.addEventListener("click", () => {
  runCapture("youtube_transcript_with_comment").catch((error) => {
    statusLine.textContent = error?.message || "Capture failed";
  });
});

openSettingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refreshStatus().catch((error) => {
  statusLine.textContent = error?.message || "Failed to load status";
});

refreshButtons().catch(() => undefined);
