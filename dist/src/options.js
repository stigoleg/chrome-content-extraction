import { buildCaptureRecord, buildFileName } from "./schema.js";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./settings.js";
import {
  clearSavedDirectoryHandle,
  ensureReadWritePermission,
  getSavedDirectoryHandle,
  saveDirectoryHandle,
  writeJsonToDirectory
} from "./storage.js";

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
/** @type {HTMLButtonElement} */
const saveSettingsButton = /** @type {HTMLButtonElement} */ (document.getElementById("saveSettingsButton"));

function setStatus(text, isError = false) {
  folderStatus.textContent = text;
  folderStatus.style.background = isError ? "#fdeaea" : "#e9f9f0";
  folderStatus.style.borderColor = isError ? "#f6bcbc" : "#b8e5cb";
  folderStatus.style.color = isError ? "#9f1f1f" : "#0f7a42";
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

async function persistCaptureSettings() {
  const nextSettings = {
    compressLargeText: compressLargeTextInput.checked,
    compressionThresholdChars: clampNumber(
      compressionThresholdInput.value,
      DEFAULT_SETTINGS.compressionThresholdChars
    ),
    storageBackend: storageBackendSqlite.checked ? "sqlite" : "json",
    organizeByDate: organizeByDateInput.checked,
    organizeByType: organizeByTypeInput.checked,
    organizeOrder: organizeOrderSelect.value === "date_type" ? "date_type" : "type_date"
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
        selectedText: null,
        documentText: "Settings test write successful.",
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
