export const BUBBLE_MENU_ACTIONS = [
  "save_content",
  "save_content_with_highlight",
  "save_content_with_note",
  "highlight",
  "highlight_with_note"
];

export const DEFAULT_BUBBLE_MENU_ORDER = [
  "save_content",
  "save_content_with_highlight",
  "highlight",
  "highlight_with_note",
  "save_content_with_note"
];

export const DEFAULT_BUBBLE_MENU_ENABLED = [
  "save_content",
  "highlight",
  "highlight_with_note"
];

export const DEFAULT_SETTINGS = {
  maxDocumentChars: 0,
  compressLargeText: true,
  compressionThresholdChars: 75000,
  storageBackend: "json",
  youtubeTranscriptStorageMode: "document_text",
  organizeByDate: false,
  organizeByType: false,
  organizeOrder: "type_date",
  bubbleMenuOrder: [...DEFAULT_BUBBLE_MENU_ORDER],
  bubbleMenuEnabled: [...DEFAULT_BUBBLE_MENU_ENABLED]
};

const SETTINGS_KEY = "captureSettings";
const STATUS_KEY = "lastCaptureStatus";

function sanitizeActionList(input) {
  const incoming = Array.isArray(input) ? input : [];
  const filtered = incoming.filter((value) => BUBBLE_MENU_ACTIONS.includes(value));
  const deduped = [];
  for (const value of filtered) {
    if (!deduped.includes(value)) {
      deduped.push(value);
    }
  }
  return deduped;
}

function normalizeBubbleSettings(input) {
  const orderFromInput = sanitizeActionList(input?.bubbleMenuOrder);
  const order = orderFromInput.length ? [...orderFromInput] : [...DEFAULT_BUBBLE_MENU_ORDER];
  for (const action of BUBBLE_MENU_ACTIONS) {
    if (!order.includes(action)) {
      order.push(action);
    }
  }

  const enabledFromInput = sanitizeActionList(input?.bubbleMenuEnabled);
  const enabled = enabledFromInput.length ? enabledFromInput : [...DEFAULT_BUBBLE_MENU_ENABLED];
  const enabledInOrder = enabled.filter((action) => order.includes(action));
  if (!enabledInOrder.length) {
    enabledInOrder.push("save_content");
  }

  return {
    bubbleMenuOrder: order,
    bubbleMenuEnabled: enabledInOrder
  };
}

function normalizeSettings(input) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(input || {})
  };
  const bubble = normalizeBubbleSettings(merged);
  return {
    ...merged,
    bubbleMenuOrder: bubble.bubbleMenuOrder,
    bubbleMenuEnabled: bubble.bubbleMenuEnabled
  };
}

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const value = result?.[SETTINGS_KEY] || {};
  return normalizeSettings(value);
}

export async function saveSettings(input) {
  const next = normalizeSettings(input);

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
