export const DEFAULT_SETTINGS = {
  maxDocumentChars: 0,
  compressLargeText: true,
  compressionThresholdChars: 75000,
  storageBackend: "json",
  youtubeTranscriptStorageMode: "document_text",
  organizeByDate: false,
  organizeByType: false,
  organizeOrder: "type_date"
};

const SETTINGS_KEY = "captureSettings";
const STATUS_KEY = "lastCaptureStatus";

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const value = result?.[SETTINGS_KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...value
  };
}

export async function saveSettings(input) {
  const next = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  await chrome.storage.local.set({
    [SETTINGS_KEY]: next
  });

  return next;
}

export async function getLastCaptureStatus() {
  const result = await chrome.storage.local.get(STATUS_KEY);
  return result?.[STATUS_KEY] || null;
}

export async function setLastCaptureStatus(status) {
  await chrome.storage.local.set({
    [STATUS_KEY]: {
      ...status,
      timestamp: new Date().toISOString()
    }
  });
}
