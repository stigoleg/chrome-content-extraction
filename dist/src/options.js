import { buildCaptureRecord, buildFileName } from "./schema.js";
import {
  BUBBLE_MENU_ACTIONS,
  DEFAULT_BUBBLE_MENU_ENABLED,
  DEFAULT_BUBBLE_MENU_ORDER,
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings
} from "./settings.js";
import {
  clearSavedDirectoryHandle,
  ensureReadWritePermission,
  getSavedDirectoryHandle,
  saveDirectoryHandle,
  writeJsonToDirectory
} from "./storage.js";

const BUBBLE_MENU_ACTION_META = {
  save_content: {
    label: "Save content",
    detail: "Save cleaned page content immediately."
  },
  save_content_with_highlight: {
    label: "Save content with highlight",
    detail: "Save content and include the current selection as a highlight."
  },
  save_content_with_note: {
    label: "Save content with a note",
    detail: "Open note input and save content with your comment."
  },
  highlight: {
    label: "Highlight",
    detail: "Queue selected text as a highlight."
  },
  highlight_with_note: {
    label: "Highlight with a note",
    detail: "Queue selected text and attach a note."
  }
};

/** @type {HTMLDivElement} */
const folderStatus = /** @type {HTMLDivElement} */ (document.getElementById("folderStatus"));
/** @type {HTMLButtonElement} */
const chooseFolderButton = /** @type {HTMLButtonElement} */ (document.getElementById("chooseFolderButton"));
/** @type {HTMLButtonElement} */
const testWriteButton = /** @type {HTMLButtonElement} */ (document.getElementById("testWriteButton"));
/** @type {HTMLButtonElement} */
const clearFolderButton = /** @type {HTMLButtonElement} */ (document.getElementById("clearFolderButton"));
/** @type {HTMLInputElement} */
const storageBackendJson = /** @type {HTMLInputElement} */ (document.getElementById("storageBackendJson"));
/** @type {HTMLInputElement} */
const storageBackendSqlite = /** @type {HTMLInputElement} */ (document.getElementById("storageBackendSqlite"));
/** @type {HTMLElement} */
const folderOrganizationSection = /** @type {HTMLElement} */ (document.getElementById("folderOrganizationSection"));
/** @type {HTMLInputElement} */
const organizeByDateInput = /** @type {HTMLInputElement} */ (document.getElementById("organizeByDateInput"));
/** @type {HTMLInputElement} */
const organizeByTypeInput = /** @type {HTMLInputElement} */ (document.getElementById("organizeByTypeInput"));
/** @type {HTMLSelectElement} */
const organizeOrderSelect = /** @type {HTMLSelectElement} */ (document.getElementById("organizeOrderSelect"));
/** @type {HTMLInputElement} */
const compressLargeTextInput = /** @type {HTMLInputElement} */ (document.getElementById("compressLargeTextInput"));
/** @type {HTMLInputElement} */
const compressionThresholdInput = /** @type {HTMLInputElement} */ (document.getElementById("compressionThresholdInput"));
/** @type {HTMLSelectElement} */
const youtubeTranscriptStorageModeSelect = /** @type {HTMLSelectElement} */ (
  document.getElementById("youtubeTranscriptStorageModeSelect")
);
/** @type {HTMLUListElement} */
const bubbleMenuList = /** @type {HTMLUListElement} */ (document.getElementById("bubbleMenuList"));
/** @type {HTMLParagraphElement} */
const bubbleMenuHint = /** @type {HTMLParagraphElement} */ (document.getElementById("bubbleMenuHint"));
/** @type {HTMLButtonElement} */
const saveSettingsButton = /** @type {HTMLButtonElement} */ (document.getElementById("saveSettingsButton"));

const bubbleState = {
  order: [...DEFAULT_BUBBLE_MENU_ORDER],
  enabled: [...DEFAULT_BUBBLE_MENU_ENABLED]
};

let dragAction = null;
let dragInsertMode = "before";

function setStatus(text, isError = false) {
  folderStatus.textContent = text;
  folderStatus.classList.toggle("is-error", Boolean(isError));
}

function normalizeBubbleSettings(orderInput, enabledInput) {
  const order = Array.isArray(orderInput) ? orderInput.filter((value) => BUBBLE_MENU_ACTIONS.includes(value)) : [];
  const normalizedOrder = order.length ? [...order] : [...DEFAULT_BUBBLE_MENU_ORDER];
  for (const action of BUBBLE_MENU_ACTIONS) {
    if (!normalizedOrder.includes(action)) {
      normalizedOrder.push(action);
    }
  }

  const enabled = Array.isArray(enabledInput)
    ? enabledInput.filter((value) => BUBBLE_MENU_ACTIONS.includes(value))
    : [];
  const normalizedEnabled = enabled.length ? [...enabled] : [...DEFAULT_BUBBLE_MENU_ENABLED];
  const dedupedEnabled = [];
  for (const action of normalizedEnabled) {
    if (!dedupedEnabled.includes(action)) {
      dedupedEnabled.push(action);
    }
  }
  if (!dedupedEnabled.length) {
    dedupedEnabled.push("save_content");
  }

  return {
    order: normalizedOrder,
    enabled: dedupedEnabled
  };
}

function isActionEnabled(action) {
  return bubbleState.enabled.includes(action);
}

function clearDropIndicators() {
  const items = bubbleMenuList.querySelectorAll(".bubble-option");
  for (const item of items) {
    item.classList.remove("drop-before");
    item.classList.remove("drop-after");
    item.classList.remove("is-dragging");
  }
}

function moveAction(action, target, mode) {
  if (!action || !target || action === target) {
    return;
  }

  const currentOrder = [...bubbleState.order];
  const actionIndex = currentOrder.indexOf(action);
  const targetIndex = currentOrder.indexOf(target);
  if (actionIndex < 0 || targetIndex < 0) {
    return;
  }

  currentOrder.splice(actionIndex, 1);
  const targetIndexAfterRemoval = currentOrder.indexOf(target);
  const insertAt = mode === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
  currentOrder.splice(insertAt, 0, action);
  bubbleState.order = currentOrder;
}

function handleActionToggle(action, checked) {
  if (!checked) {
    const next = bubbleState.enabled.filter((value) => value !== action);
    if (!next.length) {
      setStatus("At least one bubble action must stay enabled.", true);
      renderBubbleMenuOptions();
      return;
    }
    bubbleState.enabled = next;
  } else if (!bubbleState.enabled.includes(action)) {
    bubbleState.enabled = [...bubbleState.enabled, action];
  }

  updateBubbleHint();
}

function updateBubbleHint() {
  const enabledCount = bubbleState.order.filter((action) => bubbleState.enabled.includes(action)).length;
  bubbleMenuHint.textContent =
    enabledCount === 1
      ? "1 action enabled. Drag to reorder."
      : `${enabledCount} actions enabled. Drag to reorder.`;
}

function renderBubbleMenuOptions() {
  bubbleMenuList.textContent = "";
  for (const action of bubbleState.order) {
    const meta = BUBBLE_MENU_ACTION_META[action] || { label: action, detail: "" };
    const item = document.createElement("li");
    item.className = "bubble-option";
    item.dataset.action = action;
    item.draggable = true;

    const handle = document.createElement("span");
    handle.className = "bubble-option__handle";
    handle.textContent = "⋮⋮";
    handle.setAttribute("aria-hidden", "true");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "bubble-option__checkbox";
    checkbox.checked = isActionEnabled(action);
    checkbox.id = `bubbleAction-${action}`;

    const copy = document.createElement("label");
    copy.className = "bubble-option__copy";
    copy.htmlFor = checkbox.id;

    const title = document.createElement("span");
    title.className = "bubble-option__title";
    title.textContent = meta.label;

    const detail = document.createElement("span");
    detail.className = "bubble-option__detail";
    detail.textContent = meta.detail;

    copy.append(title, detail);
    item.append(handle, checkbox, copy);

    checkbox.addEventListener("change", () => {
      handleActionToggle(action, checkbox.checked);
    });

    item.addEventListener("dragstart", (event) => {
      dragAction = action;
      item.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", action);
      }
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (dragAction === action) {
        return;
      }
      const rect = item.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      dragInsertMode = offsetY > rect.height / 2 ? "after" : "before";
      item.classList.toggle("drop-before", dragInsertMode === "before");
      item.classList.toggle("drop-after", dragInsertMode === "after");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-before");
      item.classList.remove("drop-after");
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragAction) {
        return;
      }
      moveAction(dragAction, action, dragInsertMode);
      clearDropIndicators();
      renderBubbleMenuOptions();
    });

    item.addEventListener("dragend", () => {
      dragAction = null;
      clearDropIndicators();
    });

    bubbleMenuList.appendChild(item);
  }

  updateBubbleHint();
}

async function refreshStatus() {
  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    setStatus("No folder selected.", true);
    return;
  }

  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission === "granted") {
    setStatus(`Folder linked: ${handle.name}`);
    return;
  }

  setStatus(`Folder linked but permission needed: ${handle.name}`, true);
}

async function refreshCaptureSettings() {
  const settings = await getSettings();
  storageBackendJson.checked = settings.storageBackend !== "sqlite";
  storageBackendSqlite.checked = settings.storageBackend === "sqlite";
  organizeByDateInput.checked = Boolean(settings.organizeByDate);
  organizeByTypeInput.checked = Boolean(settings.organizeByType);
  organizeOrderSelect.value = settings.organizeOrder || "type_date";
  toggleOrganizationInputs(settings.storageBackend === "sqlite");
  compressLargeTextInput.checked = Boolean(settings.compressLargeText);
  compressionThresholdInput.value = String(settings.compressionThresholdChars);
  youtubeTranscriptStorageModeSelect.value = normalizeTranscriptStorageMode(
    settings.youtubeTranscriptStorageMode
  );

  const bubble = normalizeBubbleSettings(settings.bubbleMenuOrder, settings.bubbleMenuEnabled);
  bubbleState.order = bubble.order;
  bubbleState.enabled = bubble.enabled;
  renderBubbleMenuOptions();
}

function toggleOrganizationInputs(disabled) {
  organizeByDateInput.disabled = disabled;
  organizeByTypeInput.disabled = disabled;
  organizeOrderSelect.disabled = disabled;
  folderOrganizationSection.hidden = disabled;
}

function updateOrderVisibility() {
  const showOrder = organizeByDateInput.checked && organizeByTypeInput.checked;
  organizeOrderSelect.disabled = !showOrder;
  const orderField = /** @type {HTMLElement|null} */ (organizeOrderSelect.closest(".field"));
  if (orderField) {
    orderField.hidden = !showOrder;
  }
}

function clampNumber(input, fallback) {
  const value = Number.parseInt(input, 10);
  if (Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(1000, value);
}

function normalizeTranscriptStorageMode(value) {
  if (value === "segments" || value === "both") {
    return value;
  }
  return "document_text";
}

async function persistCaptureSettings() {
  const normalizedBubble = normalizeBubbleSettings(bubbleState.order, bubbleState.enabled);
  const nextSettings = {
    compressLargeText: compressLargeTextInput.checked,
    compressionThresholdChars: clampNumber(
      compressionThresholdInput.value,
      DEFAULT_SETTINGS.compressionThresholdChars
    ),
    storageBackend: storageBackendSqlite.checked ? "sqlite" : "json",
    youtubeTranscriptStorageMode: normalizeTranscriptStorageMode(
      youtubeTranscriptStorageModeSelect.value
    ),
    organizeByDate: organizeByDateInput.checked,
    organizeByType: organizeByTypeInput.checked,
    organizeOrder: organizeOrderSelect.value === "date_type" ? "date_type" : "type_date",
    bubbleMenuOrder: normalizedBubble.order,
    bubbleMenuEnabled: normalizedBubble.enabled
  };

  await saveSettings(nextSettings);
  setStatus("Capture settings saved.");
}

async function chooseFolder() {
  const picker = /** @type {any} */ (window).showDirectoryPicker;
  if (typeof picker !== "function") {
    setStatus("Directory picker is not available in this Chrome version.", true);
    return;
  }

  try {
    const handle = await picker({ mode: "readwrite" });
    const granted = await ensureReadWritePermission(handle);
    if (!granted) {
      setStatus("Folder permission was not granted.", true);
      return;
    }

    await saveDirectoryHandle(handle);
    setStatus(`Folder linked: ${handle.name}`);
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    setStatus(`Failed to choose folder: ${error?.message || "Unknown error"}`, true);
  }
}

async function testWrite() {
  try {
    const handle = await getSavedDirectoryHandle();
    if (!handle) {
      setStatus("Select a folder first.", true);
      return;
    }

    const granted = await ensureReadWritePermission(handle);
    if (!granted) {
      setStatus("Folder permission was denied.", true);
      return;
    }

    const record = buildCaptureRecord({
      captureType: "settings_test",
      source: {
        url: chrome.runtime.getURL("src/options.html"),
        title: "Settings Test",
        site: "extension",
        language: "en",
        metadata: {
          note: "Connectivity test file"
        }
      },
      content: {
        documentText: "Settings test write successful.",
        annotations: null,
        transcriptText: null,
        transcriptSegments: null
      }
    });

    const settings = await getSettings();
    if (settings.storageBackend === "sqlite") {
      const { saveRecordToSqlite } = await import("./sqlite.js");
      const dbFileName = await saveRecordToSqlite(handle, record);
      setStatus(`Test record saved to ${dbFileName}`);
      return;
    }

    const fileName = buildFileName(record);
    const subdirectories = [];
    const date = new Date(record.savedAt);
    const dateSegment = Number.isNaN(date.getTime())
      ? null
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
          date.getDate()
        ).padStart(2, "0")}`;
    const typeSegment = String(record.captureType || "capture")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "capture";

    const order = settings.organizeOrder === "date_type" ? "date_type" : "type_date";
    if (order === "date_type") {
      if (settings.organizeByDate && dateSegment) {
        subdirectories.push(dateSegment);
      }
      if (settings.organizeByType) {
        subdirectories.push(typeSegment);
      }
    } else {
      if (settings.organizeByType) {
        subdirectories.push(typeSegment);
      }
      if (settings.organizeByDate && dateSegment) {
        subdirectories.push(dateSegment);
      }
    }

    await writeJsonToDirectory(handle, fileName, record, subdirectories);
    const storedPath = subdirectories.length ? `${subdirectories.join("/")}/${fileName}` : fileName;
    setStatus(`Test file saved: ${storedPath}`);
  } catch (error) {
    setStatus(`Test write failed: ${error?.message || "Unknown error"}`, true);
  }
}

async function clearFolder() {
  await clearSavedDirectoryHandle();
  setStatus("Folder selection cleared.", true);
}

chooseFolderButton.addEventListener("click", () => {
  chooseFolder().catch((error) => setStatus(error?.message || "Failed", true));
});

testWriteButton.addEventListener("click", () => {
  testWrite().catch((error) => setStatus(error?.message || "Failed", true));
});

clearFolderButton.addEventListener("click", () => {
  clearFolder().catch((error) => setStatus(error?.message || "Failed", true));
});

saveSettingsButton.addEventListener("click", () => {
  persistCaptureSettings().catch((error) => setStatus(error?.message || "Failed", true));
});

storageBackendJson.addEventListener("change", () => {
  toggleOrganizationInputs(false);
  updateOrderVisibility();
});
storageBackendSqlite.addEventListener("change", () => {
  toggleOrganizationInputs(true);
  updateOrderVisibility();
});
organizeByDateInput.addEventListener("change", updateOrderVisibility);
organizeByTypeInput.addEventListener("change", updateOrderVisibility);

refreshStatus().catch((error) => setStatus(error?.message || "Failed", true));
refreshCaptureSettings()
  .then(updateOrderVisibility)
  .catch((error) => setStatus(error?.message || "Failed", true));
