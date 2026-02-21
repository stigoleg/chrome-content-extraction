import { getSettings } from "./settings.js";
import {
  filterAndSortCaptures,
  paginateCaptures,
  extractFilterOptions,
  buildCaptureSummaryFromJsonRecord,
  buildCaptureSummaryFromSqlite
} from "./library-data.js";
import { buildContextExportPayload, groupChunksByType } from "./document-context.js";
import { resolveStorageBackendWrites } from "./storage-backend.js";
import { getSavedDirectoryHandle } from "./storage.js";
import { validateCaptureRecord } from "./schema.js";
import { writeFileHandleWithRetry } from "./write-retry.js";
import {
  buildJsonChunksForRecord,
  DEFAULT_DB_NAME,
  getCaptureEditVersion,
  getCaptureForEditing,
  hasChunkFtsIndex,
  getDocumentContext,
  listRecentCaptures,
  openSqliteFromDirectoryHandle,
  searchChunksByText,
  updateCaptureInDb
} from "./sqlite.js";

const MAX_SQLITE_SCAN = 10000;
const SQLITE_BATCH_SIZE = 250;
const MAX_JSON_SCAN = 2000;
const SEARCH_DEBOUNCE_MS = 180;
const CHUNK_SEARCH_LIMIT = 40;
const EDITOR_VERSION = "library-ui-v1";

/** @type {HTMLButtonElement} */
const refreshButton = /** @type {HTMLButtonElement} */ (document.getElementById("refreshButton"));
/** @type {HTMLButtonElement} */
const openSettingsButton = /** @type {HTMLButtonElement} */ (document.getElementById("openSettingsButton"));
/** @type {HTMLInputElement} */
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById("searchInput"));
/** @type {HTMLSelectElement} */
const typeFilter = /** @type {HTMLSelectElement} */ (document.getElementById("typeFilter"));
/** @type {HTMLSelectElement} */
const siteFilter = /** @type {HTMLSelectElement} */ (document.getElementById("siteFilter"));
/** @type {HTMLInputElement} */
const fromDateInput = /** @type {HTMLInputElement} */ (document.getElementById("fromDateInput"));
/** @type {HTMLInputElement} */
const toDateInput = /** @type {HTMLInputElement} */ (document.getElementById("toDateInput"));
/** @type {HTMLSelectElement} */
const sortFieldSelect = /** @type {HTMLSelectElement} */ (document.getElementById("sortFieldSelect"));
/** @type {HTMLSelectElement} */
const sortDirectionSelect = /** @type {HTMLSelectElement} */ (document.getElementById("sortDirectionSelect"));
/** @type {HTMLSelectElement} */
const pageSizeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("pageSizeSelect"));
/** @type {HTMLElement} */
const statusRow = /** @type {HTMLElement} */ (document.getElementById("statusRow"));
/** @type {HTMLElement} */
const resultCount = /** @type {HTMLElement} */ (document.getElementById("resultCount"));
/** @type {HTMLUListElement} */
const captureList = /** @type {HTMLUListElement} */ (document.getElementById("captureList"));
/** @type {HTMLElement} */
const emptyListMessage = /** @type {HTMLElement} */ (document.getElementById("emptyListMessage"));
/** @type {HTMLButtonElement} */
const prevPageButton = /** @type {HTMLButtonElement} */ (document.getElementById("prevPageButton"));
/** @type {HTMLButtonElement} */
const nextPageButton = /** @type {HTMLButtonElement} */ (document.getElementById("nextPageButton"));
/** @type {HTMLElement} */
const pageLabel = /** @type {HTMLElement} */ (document.getElementById("pageLabel"));
/** @type {HTMLElement} */
const detailMeta = /** @type {HTMLElement} */ (document.getElementById("detailMeta"));
/** @type {HTMLElement} */
const detailContent = /** @type {HTMLElement} */ (document.getElementById("detailContent"));
/** @type {HTMLButtonElement} */
const openContextButton = /** @type {HTMLButtonElement} */ (document.getElementById("openContextButton"));
/** @type {HTMLInputElement} */
const chunkSearchInput = /** @type {HTMLInputElement} */ (document.getElementById("chunkSearchInput"));
/** @type {HTMLElement} */
const chunkSearchStatus = /** @type {HTMLElement} */ (document.getElementById("chunkSearchStatus"));
/** @type {HTMLUListElement} */
const chunkSearchResults = /** @type {HTMLUListElement} */ (document.getElementById("chunkSearchResults"));
/** @type {HTMLElement} */
const documentContextPane = /** @type {HTMLElement} */ (document.getElementById("documentContextPane"));
/** @type {HTMLElement} */
const documentContextContent = /** @type {HTMLElement} */ (document.getElementById("documentContextContent"));
/** @type {HTMLButtonElement} */
const copyContextButton = /** @type {HTMLButtonElement} */ (document.getElementById("copyContextButton"));
/** @type {HTMLButtonElement} */
const exportContextButton = /** @type {HTMLButtonElement} */ (document.getElementById("exportContextButton"));
/** @type {HTMLButtonElement} */
const closeContextButton = /** @type {HTMLButtonElement} */ (document.getElementById("closeContextButton"));
/** @type {HTMLButtonElement} */
const editCaptureButton = /** @type {HTMLButtonElement} */ (document.getElementById("editCaptureButton"));
/** @type {HTMLButtonElement} */
const saveCaptureEditsButton = /** @type {HTMLButtonElement} */ (
  document.getElementById("saveCaptureEditsButton")
);
/** @type {HTMLButtonElement} */
const cancelCaptureEditsButton = /** @type {HTMLButtonElement} */ (
  document.getElementById("cancelCaptureEditsButton")
);
/** @type {HTMLElement} */
const editPanel = /** @type {HTMLElement} */ (document.getElementById("editPanel"));
/** @type {HTMLInputElement} */
const editTitleInput = /** @type {HTMLInputElement} */ (document.getElementById("editTitleInput"));
/** @type {HTMLButtonElement} */
const addHighlightEditButton = /** @type {HTMLButtonElement} */ (
  document.getElementById("addHighlightEditButton")
);
/** @type {HTMLButtonElement} */
const addNoteEditButton = /** @type {HTMLButtonElement} */ (document.getElementById("addNoteEditButton"));
/** @type {HTMLUListElement} */
const editAnnotationsList = /** @type {HTMLUListElement} */ (document.getElementById("editAnnotationsList"));
/** @type {HTMLElement} */
const editPanelHint = /** @type {HTMLElement} */ (document.getElementById("editPanelHint"));

const state = {
  directoryHandle: null,
  captures: [],
  selectedKey: "",
  page: 1,
  filters: {
    captureType: "",
    site: "",
    search: "",
    fromDate: "",
    toDate: ""
  },
  sort: {
    field: "savedAt",
    direction: "desc"
  },
  pageSize: 25,
  sqliteSession: null,
  detailCache: new Map(),
  jsonDescriptors: new Map(),
  detailRequestId: 0,
  warnings: [],
  selectedSummary: null,
  activeContext: null,
  editMode: false,
  editBaselineVersionByKey: new Map(),
  editDraft: null
};

let searchDebounceTimer = 0;
let chunkSearchDebounceTimer = 0;

function formatDate(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "Unknown";
  }
  return new Date(parsed).toLocaleString();
}

function setStatus(message, mode = "ok") {
  statusRow.textContent = message;
  statusRow.classList.remove("is-warning", "is-error");
  if (mode === "warning") {
    statusRow.classList.add("is-warning");
  }
  if (mode === "error") {
    statusRow.classList.add("is-error");
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHighlightedHtml(text, query) {
  const safeText = escapeHtml(text);
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return safeText;
  }
  const escapedPattern = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedPattern) {
    return safeText;
  }
  const regex = new RegExp(`(${escapedPattern})`, "ig");
  return safeText.replace(regex, "<mark>$1</mark>");
}

function updateChunkSearchStatus(message) {
  chunkSearchStatus.textContent = message;
}

function captureKey(summary) {
  if (summary.backend === "json") {
    return `json:${summary.storagePath}`;
  }
  return `sqlite:${summary.captureId}`;
}

function normalizeAnnotationDraft(annotation, index = 0) {
  const selectedText = String(annotation?.selectedText || annotation?.selected_text || "").trim();
  const commentRaw = annotation?.comment;
  const comment = commentRaw === undefined || commentRaw === null ? "" : String(commentRaw);
  return {
    id: String(annotation?.id || annotation?.annotation_id || `draft-${Date.now()}-${index}`),
    selectedText,
    comment,
    createdAt: String(annotation?.createdAt || annotation?.created_at || new Date().toISOString())
  };
}

function buildEditableAnnotations(detail) {
  if (Array.isArray(detail?.annotations) && detail.annotations.length) {
    return detail.annotations.map(normalizeAnnotationDraft).filter((entry) => entry.selectedText || entry.comment);
  }

  if (!Array.isArray(detail?.chunks)) {
    return [];
  }

  return detail.chunks
    .filter((chunk) => chunk.chunk_type === "highlight" || chunk.chunk_type === "note")
    .map((chunk, index) =>
      normalizeAnnotationDraft(
        {
          annotation_id: chunk.chunk_id || `chunk-annotation-${index}`,
          selected_text: chunk.text || "",
          comment: chunk.comment || "",
          created_at: chunk.created_at || detail?.savedAt || new Date().toISOString()
        },
        index
      )
    )
    .filter((entry) => entry.selectedText || entry.comment);
}

function findCounterpartCapture(summary) {
  if (!summary?.captureId) {
    return null;
  }
  return (
    state.captures.find(
      (capture) => capture.captureId === summary.captureId && capture.backend !== summary.backend
    ) || null
  );
}

function setEditButtonsDisabled(disabled) {
  saveCaptureEditsButton.disabled = disabled;
  cancelCaptureEditsButton.disabled = disabled;
  addHighlightEditButton.disabled = disabled;
  addNoteEditButton.disabled = disabled;
  editTitleInput.disabled = disabled;
  const textareas = editAnnotationsList.querySelectorAll("textarea");
  for (const textarea of textareas) {
    textarea.disabled = disabled;
  }
  const buttons = editAnnotationsList.querySelectorAll("button");
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

function leaveEditMode() {
  state.editMode = false;
  state.editDraft = null;
  editPanel.hidden = true;
  editAnnotationsList.textContent = "";
  editPanelHint.textContent = "";
  editCaptureButton.hidden = false;
  saveCaptureEditsButton.hidden = true;
  cancelCaptureEditsButton.hidden = true;
  setEditButtonsDisabled(false);
}

function renderEditPanel() {
  if (!state.editMode || !state.editDraft) {
    leaveEditMode();
    return;
  }

  editPanel.hidden = false;
  editCaptureButton.hidden = true;
  saveCaptureEditsButton.hidden = false;
  cancelCaptureEditsButton.hidden = false;
  editTitleInput.value = state.editDraft.title || "";
  editAnnotationsList.textContent = "";

  state.editDraft.annotations.forEach((annotation) => {
    const item = document.createElement("li");
    item.className = "edit-annotation-item";
    item.dataset.annotationId = annotation.id;

    const meta = document.createElement("div");
    meta.className = "edit-annotation-item__meta";

    const typeLabel = document.createElement("span");
    typeLabel.className = "edit-annotation-item__type";
    typeLabel.textContent = annotation.comment.trim() ? "Note" : "Highlight";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost";
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", () => {
      state.editDraft.annotations = state.editDraft.annotations.filter((entry) => entry.id !== annotation.id);
      renderEditPanel();
    });

    meta.append(typeLabel, removeButton);

    const selectedTextArea = document.createElement("textarea");
    selectedTextArea.value = annotation.selectedText;
    selectedTextArea.placeholder = "Selected text";
    selectedTextArea.addEventListener("input", () => {
      const target = state.editDraft.annotations.find((entry) => entry.id === annotation.id);
      if (!target) {
        return;
      }
      target.selectedText = selectedTextArea.value;
    });

    const commentArea = document.createElement("textarea");
    commentArea.value = annotation.comment;
    commentArea.placeholder = "Optional note";
    commentArea.addEventListener("input", () => {
      const target = state.editDraft.annotations.find((entry) => entry.id === annotation.id);
      if (!target) {
        return;
      }
      target.comment = commentArea.value;
      typeLabel.textContent = target.comment.trim() ? "Note" : "Highlight";
    });

    item.append(meta, selectedTextArea, commentArea);
    editAnnotationsList.appendChild(item);
  });

  editPanelHint.textContent = `${state.editDraft.annotations.length} annotation${
    state.editDraft.annotations.length === 1 ? "" : "s"
  } queued.`;
}

async function resolveEditVersionForSummary(summary) {
  if (!summary) {
    return null;
  }

  if (summary.backend === "sqlite") {
    if (!state.sqliteSession?.db) {
      return null;
    }
    return getCaptureEditVersion(state.sqliteSession.db, summary.captureId);
  }

  const descriptor = state.jsonDescriptors.get(summary._key);
  if (!descriptor) {
    return null;
  }
  const { lastModified } = await readJsonRecordByDescriptor(descriptor, { withMetadata: true });
  descriptor.lastModified = lastModified;
  return String(lastModified);
}

function parseDocumentRoute() {
  const rawHash = String(window.location.hash || "");
  if (!rawHash.startsWith("#document/")) {
    return "";
  }
  const encoded = rawHash.slice("#document/".length);
  try {
    return decodeURIComponent(encoded);
  } catch (_error) {
    return "";
  }
}

function setDocumentRoute(documentId) {
  const normalized = String(documentId || "").trim();
  if (!normalized) {
    if (window.location.hash.startsWith("#document/")) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    return;
  }
  const target = `#document/${encodeURIComponent(normalized)}`;
  if (window.location.hash !== target) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${target}`);
  }
}

function renderOptions(selectElement, values, allLabel) {
  const previous = selectElement.value;
  selectElement.textContent = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  selectElement.appendChild(allOption);

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  }

  if ([...selectElement.options].some((option) => option.value === previous)) {
    selectElement.value = previous;
  }
}

function renderCaptureList(pageResult) {
  captureList.textContent = "";
  emptyListMessage.hidden = pageResult.items.length > 0;

  for (const summary of pageResult.items) {
    const item = document.createElement("li");
    item.className = "capture-item";
    if (summary._key === state.selectedKey) {
      item.classList.add("is-selected");
    }

    const title = document.createElement("div");
    title.className = "capture-item__title";
    title.textContent = summary.sourceTitle || summary.sourceUrl || "Untitled capture";

    const meta = document.createElement("div");
    meta.className = "capture-item__meta";
    meta.textContent = `${summary.captureType || "unknown"} · ${summary.sourceSite || "unknown site"} · ${formatDate(summary.savedAt)}`;

    const path = document.createElement("div");
    path.className = "capture-item__path";
    path.textContent = summary.storagePath || summary.backend;

    item.append(title, meta, path);
    item.addEventListener("click", () => {
      if (state.selectedKey !== summary._key) {
        leaveEditMode();
      }
      state.selectedKey = summary._key;
      renderLibrary();
      loadAndRenderDetail(summary).catch((error) => {
        detailMeta.textContent = "Failed to load detail";
        detailContent.textContent = error?.message || "Unknown detail error";
      });
    });

    captureList.appendChild(item);
  }
}

function createDetailCard(title, body) {
  const card = document.createElement("section");
  card.className = "detail-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  card.appendChild(heading);
  card.appendChild(body);
  return card;
}

function renderDetail(detail, summary) {
  detailContent.textContent = "";

  const metaList = document.createElement("dl");
  metaList.className = "detail-grid";
  const metadataPairs = [
    ["Capture ID", summary.captureId || "(none)"],
    ["Type", summary.captureType || "unknown"],
    ["Saved", formatDate(summary.savedAt)],
    ["Site", summary.sourceSite || "unknown"],
    ["URL", summary.sourceUrl || "unknown"],
    ["Storage", summary.storagePath || summary.backend]
  ];

  for (const [label, value] of metadataPairs) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value || "");
    metaList.append(dt, dd);
  }
  detailContent.appendChild(createDetailCard("Metadata", metaList));

  const text = String(detail.documentText || "").trim();
  if (text) {
    const pre = document.createElement("pre");
    const maxLength = 200000;
    pre.textContent =
      text.length > maxLength
        ? `${text.slice(0, maxLength)}\n\n[Truncated ${text.length - maxLength} chars]`
        : text;
    detailContent.appendChild(createDetailCard("Document Text", pre));
  }

  if (Array.isArray(detail.chunks) && detail.chunks.length) {
    const chunkList = document.createElement("ul");
    chunkList.className = "chunk-list";
    const previewLimit = 200;
    for (const chunk of detail.chunks.slice(0, previewLimit)) {
      const item = document.createElement("li");
      const chunkType = chunk.chunk_type || "chunk";
      const chunkText = String(chunk.text || "").replace(/\s+/g, " ").trim();
      item.textContent = `${chunkType}: ${chunkText.slice(0, 220)}${chunkText.length > 220 ? "..." : ""}`;
      chunkList.appendChild(item);
    }
    if (detail.chunks.length > previewLimit) {
      const extra = document.createElement("li");
      extra.textContent = `... ${detail.chunks.length - previewLimit} more chunks`;
      chunkList.appendChild(extra);
    }
    detailContent.appendChild(createDetailCard(`Chunks (${detail.chunks.length})`, chunkList));
  }

  if (Array.isArray(detail.transcriptSegments) && detail.transcriptSegments.length) {
    const transcriptPre = document.createElement("pre");
    transcriptPre.textContent = detail.transcriptSegments
      .slice(0, 300)
      .map((segment) => {
        const stamp = segment.timestamp ? `[${segment.timestamp}] ` : "";
        return `${stamp}${segment.text || ""}`.trim();
      })
      .join("\n");
    detailContent.appendChild(
      createDetailCard(`Transcript Segments (${detail.transcriptSegments.length})`, transcriptPre)
    );
  }

  if (detail.diagnostics) {
    const diagnostics = document.createElement("pre");
    diagnostics.textContent = JSON.stringify(detail.diagnostics, null, 2);
    detailContent.appendChild(createDetailCard("Diagnostics", diagnostics));
  }

  if (!detailContent.children.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "No detail content available for this capture.";
    detailContent.appendChild(empty);
  }
}

function renderDocumentContext(context) {
  documentContextContent.textContent = "";
  if (!context?.document) {
    documentContextContent.innerHTML = '<p class="empty-message">Document context is unavailable.</p>';
    return;
  }

  const overviewList = document.createElement("dl");
  overviewList.className = "detail-grid";
  const pairs = [
    ["Document ID", context.document.document_id || context.document.documentId || ""],
    ["URL", context.document.url || ""],
    ["Title", context.document.title || ""],
    ["Site", context.document.site || ""],
    ["Captures", String(Array.isArray(context.captures) ? context.captures.length : 0)],
    ["Chunks", String(Array.isArray(context.chunks) ? context.chunks.length : 0)],
    ["Entities", String(Array.isArray(context.entities) ? context.entities.length : 0)],
    ["Edges", String(Array.isArray(context.edges) ? context.edges.length : 0)]
  ];
  for (const [label, value] of pairs) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    overviewList.append(dt, dd);
  }
  documentContextContent.appendChild(createDetailCard("Overview", overviewList));

  const captures = Array.isArray(context.captures) ? context.captures : [];
  if (captures.length) {
    const captureList = document.createElement("ul");
    captureList.className = "chunk-list";
    for (const capture of captures.slice(0, 200)) {
      const item = document.createElement("li");
      item.textContent = `${capture.capture_type || "capture"} · ${formatDate(capture.saved_at)}`;
      captureList.appendChild(item);
    }
    documentContextContent.appendChild(createDetailCard(`Capture Timeline (${captures.length})`, captureList));
  }

  const chunkGroups = groupChunksByType(context.chunks || []);
  if (chunkGroups.length) {
    const groupList = document.createElement("div");
    groupList.className = "detail-content";
    for (const group of chunkGroups) {
      const list = document.createElement("ul");
      list.className = "chunk-list";
      for (const chunk of group.items.slice(0, 30)) {
        const item = document.createElement("li");
        const text = String(chunk.text || "").replace(/\s+/g, " ").trim();
        item.textContent = text.slice(0, 220) + (text.length > 220 ? "..." : "");
        list.appendChild(item);
      }
      groupList.appendChild(createDetailCard(`${group.type} (${group.count})`, list));
    }
    documentContextContent.appendChild(createDetailCard("Chunks By Type", groupList));
  }

  const entities = Array.isArray(context.entities) ? context.entities : [];
  const edges = Array.isArray(context.edges) ? context.edges : [];
  if (entities.length || edges.length) {
    const graphMeta = document.createElement("pre");
    graphMeta.textContent = JSON.stringify(
      {
        entities: entities.map((entity) => ({
          entity_id: entity.entity_id,
          entity_type: entity.entity_type,
          name: entity.name
        })),
        edges: edges.map((edge) => ({
          edge_id: edge.edge_id,
          predicate: edge.predicate,
          from_entity_id: edge.from_entity_id,
          to_entity_id: edge.to_entity_id
        }))
      },
      null,
      2
    );
    documentContextContent.appendChild(createDetailCard("Related Graph Links", graphMeta));
  }
}

async function loadDocumentContextForCurrentRoute() {
  const documentId = parseDocumentRoute();
  if (!documentId) {
    state.activeContext = null;
    documentContextPane.hidden = true;
    return;
  }

  if (!state.sqliteSession?.db) {
    documentContextPane.hidden = false;
    documentContextContent.innerHTML =
      '<p class="empty-message">Document context requires SQLite capture storage.</p>';
    return;
  }

  const context = getDocumentContext(state.sqliteSession.db, documentId);
  state.activeContext = context;
  documentContextPane.hidden = false;
  renderDocumentContext(context);
}

async function loadSqliteSession(directoryHandle) {
  try {
    await directoryHandle.getFileHandle(DEFAULT_DB_NAME, { create: false });
  } catch (_error) {
    return { captures: [] };
  }

  try {
    state.sqliteSession?.db?.close();
  } catch (_error) {
    // Ignore close failures.
  }
  state.sqliteSession = null;

  const session = await openSqliteFromDirectoryHandle(directoryHandle, DEFAULT_DB_NAME);
  state.sqliteSession = session;

  const captures = [];
  for (let offset = 0; offset < MAX_SQLITE_SCAN; offset += SQLITE_BATCH_SIZE) {
    const rows = listRecentCaptures(session.db, SQLITE_BATCH_SIZE, offset);
    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      const summary = buildCaptureSummaryFromSqlite(row);
      summary._key = captureKey(summary);
      captures.push(summary);
    }

    if (rows.length < SQLITE_BATCH_SIZE) {
      break;
    }
    if (captures.length % 1000 === 0) {
      setStatus(`Loaded ${captures.length} SQLite captures...`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { captures };
}

async function getJsonScanRoots(directoryHandle) {
  try {
    const jsonHandle = await directoryHandle.getDirectoryHandle("json", { create: false });
    return [{ handle: jsonHandle, pathSegments: ["json"] }];
  } catch (_error) {
    return [{ handle: directoryHandle, pathSegments: [] }];
  }
}

function shouldSkipDirectory(name) {
  const normalized = String(name || "").toLowerCase();
  return normalized === "node_modules" || normalized === ".git" || normalized === "dist";
}

async function discoverJsonDescriptors(directoryHandle) {
  const descriptors = [];
  const roots = await getJsonScanRoots(directoryHandle);
  const stack = [...roots];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for await (const [name, entry] of current.handle.entries()) {
      if (entry.kind === "directory") {
        if (!shouldSkipDirectory(name)) {
          stack.push({
            handle: entry,
            pathSegments: [...current.pathSegments, name]
          });
        }
        continue;
      }

      if (!String(name).toLowerCase().endsWith(".json")) {
        continue;
      }

      descriptors.push({
        fileName: name,
        pathSegments: [...current.pathSegments],
        storagePath: [...current.pathSegments, name].join("/"),
        lastModified: null
      });

      if (descriptors.length >= MAX_JSON_SCAN) {
        return {
          descriptors,
          truncated: true
        };
      }
    }
  }

  return {
    descriptors,
    truncated: false
  };
}

async function readJsonRecordByDescriptor(descriptor, options = {}) {
  if (!state.directoryHandle) {
    throw new Error("Directory handle unavailable");
  }

  let current = state.directoryHandle;
  for (const segment of descriptor.pathSegments) {
    current = await current.getDirectoryHandle(segment, { create: false });
  }
  const fileHandle = await current.getFileHandle(descriptor.fileName, { create: false });
  const file = await fileHandle.getFile();
  const text = await file.text();
  const record = JSON.parse(text);
  if (options.withMetadata === true) {
    return {
      record,
      fileHandle,
      fileName: descriptor.fileName,
      pathSegments: [...descriptor.pathSegments],
      lastModified: file.lastModified
    };
  }
  return record;
}

async function loadJsonCaptures(directoryHandle) {
  const { descriptors, truncated } = await discoverJsonDescriptors(directoryHandle);
  const captures = [];

  state.jsonDescriptors.clear();

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];

    try {
      const jsonEntry = await readJsonRecordByDescriptor(descriptor, { withMetadata: true });
      const record = jsonEntry.record;
      if (!record?.id || !record?.captureType || !record?.savedAt) {
        continue;
      }
      const summary = buildCaptureSummaryFromJsonRecord(record, descriptor.storagePath);
      summary._key = captureKey(summary);
      captures.push(summary);
      descriptor.lastModified = jsonEntry.lastModified;
      state.jsonDescriptors.set(summary._key, descriptor);
    } catch (_error) {
      continue;
    }

    if ((index + 1) % 40 === 0) {
      setStatus(`Indexed ${index + 1}/${descriptors.length} JSON files...`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    captures,
    truncated
  };
}

function getSelectedSummary(filteredPageItems) {
  if (!state.selectedKey) {
    return filteredPageItems[0] || null;
  }
  return (
    state.captures.find((capture) => capture._key === state.selectedKey) ||
    filteredPageItems[0] ||
    null
  );
}

function renderLibrary() {
  const filtered = filterAndSortCaptures(state.captures, state.filters, state.sort);
  const pageResult = paginateCaptures(filtered, state.page, state.pageSize);
  state.page = pageResult.page;

  resultCount.textContent = `${pageResult.total} result${pageResult.total === 1 ? "" : "s"}`;
  pageLabel.textContent = `Page ${pageResult.page} of ${pageResult.totalPages}`;
  prevPageButton.disabled = !pageResult.hasPrev;
  nextPageButton.disabled = !pageResult.hasNext;

  renderCaptureList(pageResult);

  const selected = getSelectedSummary(pageResult.items);
  if (selected) {
    state.selectedSummary = selected;
    if (!state.selectedKey || state.selectedKey !== selected._key) {
      state.selectedKey = selected._key;
      renderCaptureList(pageResult);
    }
    detailMeta.textContent = `${selected.captureType || "capture"} · ${formatDate(selected.savedAt)}`;
    openContextButton.disabled = !(selected.backend === "sqlite" && selected.documentId);
    editCaptureButton.disabled = false;
  } else {
    state.selectedKey = "";
    state.selectedSummary = null;
    detailMeta.textContent = "Select a capture to inspect details.";
    detailContent.innerHTML = '<p class="empty-message">No capture selected.</p>';
    openContextButton.disabled = true;
    editCaptureButton.disabled = true;
    leaveEditMode();
  }
}

function renderChunkSearchResults(results, query, modeLabel) {
  chunkSearchResults.textContent = "";
  if (!results.length) {
    const item = document.createElement("li");
    item.className = "chunk-search-result";
    item.textContent = "No chunk matches found.";
    chunkSearchResults.appendChild(item);
    updateChunkSearchStatus(`No results (${modeLabel} mode).`);
    return;
  }

  updateChunkSearchStatus(`${results.length} result${results.length === 1 ? "" : "s"} (${modeLabel} mode).`);

  for (const row of results) {
    const item = document.createElement("li");
    item.className = "chunk-search-result";

    const preview = document.createElement("div");
    const sourceText = String(row.text || row.comment || "").slice(0, 500);
    preview.innerHTML = buildHighlightedHtml(sourceText, query);

    const meta = document.createElement("div");
    meta.className = "chunk-search-result__meta";
    const type = row.chunk_type || "chunk";
    const title = row.document_title || row.document_url || "untitled";
    meta.textContent = `${type} · ${title}`;

    item.append(preview, meta);

    const captureId = String(row.capture_id || "").trim();
    if (captureId) {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        const match = state.captures.find(
          (capture) => capture.backend === "sqlite" && capture.captureId === captureId
        );
        if (!match) {
          return;
        }
        state.selectedKey = match._key;
        renderLibrary();
        loadAndRenderDetail(match).catch(() => undefined);
      });
    }

    chunkSearchResults.appendChild(item);
  }
}

function runChunkSearch(query) {
  const normalized = String(query || "").trim();
  if (!normalized) {
    chunkSearchResults.textContent = "";
    updateChunkSearchStatus("Search is available when SQLite storage is enabled.");
    return;
  }

  if (!state.sqliteSession?.db) {
    chunkSearchResults.textContent = "";
    updateChunkSearchStatus("SQLite capture data is not available for search.");
    return;
  }

  const modeLabel = hasChunkFtsIndex(state.sqliteSession.db) ? "FTS" : "LIKE";
  const results = searchChunksByText(state.sqliteSession.db, normalized, CHUNK_SEARCH_LIMIT);
  renderChunkSearchResults(results, normalized, modeLabel);
}

async function buildSqliteDetail(summary) {
  if (!state.sqliteSession?.db || !summary.documentId) {
    return null;
  }

  const context = getDocumentContext(state.sqliteSession.db, summary.documentId);
  if (!context) {
    return null;
  }

  const capture = context.captures.find((entry) => entry.capture_id === summary.captureId) || null;
  const chunks = context.chunks.filter(
    (chunk) =>
      chunk.capture_id === summary.captureId ||
      (!chunk.capture_id && chunk.document_id === summary.documentId)
  );

  const editable = getCaptureForEditing(state.sqliteSession.db, summary.captureId);
  const annotations = buildEditableAnnotations({
    annotations: editable?.record?.content?.annotations || []
  });

  return {
    documentText: capture?.document_text || "",
    transcriptSegments: Array.isArray(capture?.transcript_segments)
      ? capture.transcript_segments
      : [],
    diagnostics: capture?.diagnostics || null,
    chunks,
    annotations,
    sourceTitle: editable?.record?.source?.title || capture?.document_title || "",
    editVersion: editable?.editVersion || getCaptureEditVersion(state.sqliteSession.db, summary.captureId),
    record: editable?.record || null
  };
}

async function buildJsonDetail(summary) {
  const descriptor = state.jsonDescriptors.get(summary._key);
  if (!descriptor) {
    return null;
  }

  const { record, lastModified } = await readJsonRecordByDescriptor(descriptor, { withMetadata: true });
  descriptor.lastModified = lastModified;
  const chunks = Array.isArray(record?.content?.chunks)
    ? record.content.chunks.map((chunk, index) => ({
        chunk_id: `${record.id || "json"}-chunk-${index}`,
        chunk_type: chunk.chunkType || "chunk",
        text: chunk.text || "",
        comment: chunk.comment || null,
        capture_id: record.id || ""
      }))
    : [];

  return {
    documentText: record?.content?.documentText || "",
    transcriptSegments: Array.isArray(record?.content?.transcriptSegments)
      ? record.content.transcriptSegments
      : [],
    diagnostics: record?.diagnostics || null,
    chunks,
    annotations: buildEditableAnnotations({ annotations: record?.content?.annotations || [] }),
    sourceTitle: record?.source?.title || "",
    editVersion: String(lastModified),
    record
  };
}

async function loadAndRenderDetail(summary) {
  const requestId = state.detailRequestId + 1;
  state.detailRequestId = requestId;
  detailContent.innerHTML = '<p class="empty-message">Loading capture detail...</p>';

  if (state.detailCache.has(summary._key)) {
    if (state.detailRequestId === requestId) {
      renderDetail(state.detailCache.get(summary._key), summary);
    }
    return;
  }

  let detail = null;
  if (summary.backend === "sqlite") {
    detail = await buildSqliteDetail(summary);
  } else {
    detail = await buildJsonDetail(summary);
  }

  if (!detail) {
    detail = {
      documentText: "",
      transcriptSegments: [],
      diagnostics: { error: "Could not load detail content." },
      chunks: []
    };
  }

  state.detailCache.set(summary._key, detail);
  if (state.detailRequestId === requestId) {
    renderDetail(detail, summary);
    if (state.editMode && state.editDraft?.summaryKey === summary._key) {
      renderEditPanel();
    }
  }
}

async function beginEditForSelectedCapture() {
  const summary = state.selectedSummary;
  if (!summary) {
    return;
  }

  let detail = state.detailCache.get(summary._key);
  if (!detail) {
    await loadAndRenderDetail(summary);
    detail = state.detailCache.get(summary._key);
  }
  if (!detail) {
    setStatus("Capture detail is unavailable for editing.", "warning");
    return;
  }

  const counterpart = findCounterpartCapture(summary);
  const targets = [summary];
  if (counterpart) {
    targets.push(counterpart);
  }

  const baselineVersions = new Map();
  for (const target of targets) {
    const version = await resolveEditVersionForSummary(target);
    if (version) {
      baselineVersions.set(target._key, version);
      state.editBaselineVersionByKey.set(target._key, version);
    }
  }

  state.editMode = true;
  state.editDraft = {
    summaryKey: summary._key,
    title: String(detail.sourceTitle || summary.sourceTitle || ""),
    annotations: buildEditableAnnotations(detail),
    targetKeys: targets.map((target) => target._key),
    baselineVersions
  };
  renderEditPanel();
}

function addDraftAnnotation(withNote = false) {
  if (!state.editMode || !state.editDraft) {
    return;
  }
  state.editDraft.annotations.push(
    normalizeAnnotationDraft({
      id: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      selectedText: "",
      comment: withNote ? "Add note" : "",
      createdAt: new Date().toISOString()
    })
  );
  renderEditPanel();
}

function collectDraftEdits() {
  if (!state.editDraft) {
    return null;
  }
  const title = editTitleInput.value.trim();
  const annotations = state.editDraft.annotations
    .map((annotation) => normalizeAnnotationDraft(annotation))
    .filter((annotation) => annotation.selectedText || annotation.comment);
  return {
    title: title || null,
    annotations: annotations.length ? annotations : null
  };
}

async function writeJsonRecordEdit(targetSummary, edits, expectedVersion) {
  const descriptor = state.jsonDescriptors.get(targetSummary._key);
  if (!descriptor) {
    throw new Error("JSON descriptor not found for selected capture.");
  }
  const jsonEntry = await readJsonRecordByDescriptor(descriptor, { withMetadata: true });
  if (
    expectedVersion &&
    String(jsonEntry.lastModified) !== String(expectedVersion)
  ) {
    const error = /** @type {any} */ (new Error("Capture was modified elsewhere. Reload and try again."));
    error.code = "STALE_EDIT";
    throw error;
  }

  const record = {
    ...jsonEntry.record,
    source: {
      ...(jsonEntry.record?.source || {}),
      title:
        edits.title ||
        String(jsonEntry.record?.source?.title || targetSummary.sourceTitle || "Untitled")
    },
    content: {
      ...(jsonEntry.record?.content || {}),
      annotations: edits.annotations
    },
    editMetadata: {
      editedAt: new Date().toISOString(),
      editorVersion: EDITOR_VERSION
    }
  };

  const settings = await getSettings();
  const shouldUpdateChunks = settings.includeJsonChunks === true || Array.isArray(record?.content?.chunks);
  if (shouldUpdateChunks) {
    record.content.chunks = buildJsonChunksForRecord(record);
  }

  const validation = validateCaptureRecord(record);
  if (!validation.valid) {
    throw new Error(`Edited JSON record failed validation: ${validation.errors.join(", ")}`);
  }

  await writeFileHandleWithRetry(
    jsonEntry.fileHandle,
    `${JSON.stringify(record, null, 2)}\n`,
    { target: descriptor.storagePath }
  );
  const persisted = await jsonEntry.fileHandle.getFile();
  descriptor.lastModified = persisted.lastModified;
  state.editBaselineVersionByKey.set(targetSummary._key, String(persisted.lastModified));
}

async function writeSqliteRecordEdit(targetSummary, edits, expectedVersion) {
  if (!state.sqliteSession?.db || !state.sqliteSession?.fileHandle) {
    throw new Error("SQLite session is unavailable.");
  }

  const result = updateCaptureInDb(
    state.sqliteSession.db,
    targetSummary.captureId,
    {
      title: edits.title,
      annotations: edits.annotations
    },
    {
      ensureSchema: false,
      useTransaction: true,
      expectedVersion,
      editorVersion: EDITOR_VERSION
    }
  );
  const binaryArray = state.sqliteSession.db.export();
  await writeFileHandleWithRetry(state.sqliteSession.fileHandle, binaryArray, { target: DEFAULT_DB_NAME });
  if (result.editVersion) {
    state.editBaselineVersionByKey.set(targetSummary._key, result.editVersion);
  }
}

async function saveCurrentEditDraft() {
  if (!state.editMode || !state.editDraft || !state.selectedSummary) {
    return;
  }

  const edits = collectDraftEdits();
  if (!edits) {
    return;
  }

  const targets = state.editDraft.targetKeys
    .map((key) => state.captures.find((capture) => capture._key === key))
    .filter(Boolean);
  if (!targets.length) {
    setStatus("No matching capture targets found for edit.", "warning");
    return;
  }

  setEditButtonsDisabled(true);
  saveCaptureEditsButton.textContent = "Saving...";
  const selectedCaptureId = state.selectedSummary.captureId;

  try {
    for (const target of targets) {
      const expectedVersion = state.editDraft.baselineVersions.get(target._key) || null;
      if (target.backend === "sqlite") {
        await writeSqliteRecordEdit(target, edits, expectedVersion);
      } else {
        await writeJsonRecordEdit(target, edits, expectedVersion);
      }
    }

    leaveEditMode();
    state.detailCache.clear();
    await loadLibraryData();
    const selectedAfterSave =
      state.captures.find((capture) => capture.captureId === selectedCaptureId) || null;
    if (selectedAfterSave) {
      state.selectedKey = selectedAfterSave._key;
      renderLibrary();
      await loadAndRenderDetail(selectedAfterSave);
    }
    setStatus("Capture edits saved successfully.", "ok");
  } catch (error) {
    if (error?.code === "STALE_EDIT") {
      setStatus("Edit conflict detected. Reload and apply changes again.", "warning");
    } else {
      setStatus(error?.message || "Failed to save edits.", "error");
    }
  } finally {
    saveCaptureEditsButton.textContent = "Save edits";
    setEditButtonsDisabled(false);
  }
}

function onFilterChanged() {
  if (state.editMode) {
    leaveEditMode();
  }
  state.filters.captureType = typeFilter.value;
  state.filters.site = siteFilter.value;
  state.filters.fromDate = fromDateInput.value;
  state.filters.toDate = toDateInput.value;
  state.sort.field = sortFieldSelect.value;
  state.sort.direction = sortDirectionSelect.value;
  state.pageSize = Number.parseInt(pageSizeSelect.value, 10) || 25;
  state.page = 1;
  renderLibrary();

  const selected = state.captures.find((capture) => capture._key === state.selectedKey);
  if (selected) {
    loadAndRenderDetail(selected).catch(() => undefined);
  }
}

function handleSearchChanged() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = 0;
    state.filters.search = searchInput.value;
    state.page = 1;
    renderLibrary();

    const selected = state.captures.find((capture) => capture._key === state.selectedKey);
    if (selected) {
      loadAndRenderDetail(selected).catch(() => undefined);
    }
  }, SEARCH_DEBOUNCE_MS);
}

function handleChunkSearchChanged() {
  if (chunkSearchDebounceTimer) {
    clearTimeout(chunkSearchDebounceTimer);
  }
  chunkSearchDebounceTimer = window.setTimeout(() => {
    chunkSearchDebounceTimer = 0;
    runChunkSearch(chunkSearchInput.value);
  }, SEARCH_DEBOUNCE_MS);
}

async function loadLibraryData() {
  setStatus("Loading capture library...");

  leaveEditMode();
  state.editBaselineVersionByKey.clear();
  state.detailCache.clear();
  state.jsonDescriptors.clear();
  state.warnings = [];
  state.captures = [];
  state.selectedKey = "";
  state.page = 1;
  state.activeContext = null;
  documentContextPane.hidden = true;

  const directoryHandle = await getSavedDirectoryHandle();
  state.directoryHandle = directoryHandle;
  if (!directoryHandle) {
    setStatus("No storage folder is linked. Open Settings and select a folder.", "warning");
    updateChunkSearchStatus("SQLite capture data is not available for search.");
    chunkSearchResults.textContent = "";
    renderLibrary();
    return;
  }

  const settings = await getSettings();
  const writes = resolveStorageBackendWrites(settings.storageBackend);

  if (writes.writesSqlite) {
    try {
      const sqlite = await loadSqliteSession(directoryHandle);
      state.captures.push(...sqlite.captures);
      if (!sqlite.captures.length) {
        state.warnings.push("No SQLite captures found.");
      }
    } catch (error) {
      state.warnings.push(`SQLite load failed: ${error?.message || "Unknown error"}`);
    }
  }

  if (writes.writesJson) {
    try {
      const json = await loadJsonCaptures(directoryHandle);
      state.captures.push(...json.captures);
      if (json.truncated) {
        state.warnings.push(`JSON scan truncated at ${MAX_JSON_SCAN} files for responsiveness.`);
      }
    } catch (error) {
      state.warnings.push(`JSON load failed: ${error?.message || "Unknown error"}`);
    }
  }

  const options = extractFilterOptions(state.captures);
  renderOptions(typeFilter, options.captureTypes, "All types");
  renderOptions(siteFilter, options.sites, "All sites");
  chunkSearchResults.textContent = "";

  if (state.sqliteSession?.db) {
    const mode = hasChunkFtsIndex(state.sqliteSession.db) ? "FTS" : "LIKE";
    updateChunkSearchStatus(`Search ready (${mode} mode).`);
  } else {
    updateChunkSearchStatus("SQLite capture data is not available for search.");
  }

  renderLibrary();

  const firstCapture = state.captures[0] || null;
  if (firstCapture) {
    state.selectedKey = firstCapture._key;
    renderLibrary();
    await loadAndRenderDetail(firstCapture);
  }

  if (!state.captures.length) {
    setStatus("No captures found in the selected storage folder.", "warning");
  } else if (state.warnings.length) {
    setStatus(state.warnings.join(" "), "warning");
  } else {
    setStatus(`Loaded ${state.captures.length} captures.`, "ok");
  }

  if (chunkSearchInput.value.trim()) {
    runChunkSearch(chunkSearchInput.value);
  }

  await loadDocumentContextForCurrentRoute();
}

refreshButton.addEventListener("click", () => {
  loadLibraryData().catch((error) => {
    setStatus(error?.message || "Failed to load library", "error");
  });
});

openSettingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

editCaptureButton.addEventListener("click", () => {
  beginEditForSelectedCapture().catch((error) => {
    setStatus(error?.message || "Failed to start editing mode.", "error");
  });
});

saveCaptureEditsButton.addEventListener("click", () => {
  saveCurrentEditDraft().catch((error) => {
    setStatus(error?.message || "Failed to save edits.", "error");
  });
});

cancelCaptureEditsButton.addEventListener("click", () => {
  leaveEditMode();
});

addHighlightEditButton.addEventListener("click", () => {
  addDraftAnnotation(false);
});

addNoteEditButton.addEventListener("click", () => {
  addDraftAnnotation(true);
});

editTitleInput.addEventListener("input", () => {
  if (!state.editDraft) {
    return;
  }
  state.editDraft.title = editTitleInput.value;
});

openContextButton.addEventListener("click", () => {
  const selected = state.selectedSummary;
  if (!selected?.documentId) {
    return;
  }
  setDocumentRoute(selected.documentId);
  loadDocumentContextForCurrentRoute().catch((error) => {
    setStatus(error?.message || "Failed to load document context", "error");
  });
});

closeContextButton.addEventListener("click", () => {
  setDocumentRoute("");
  state.activeContext = null;
  documentContextPane.hidden = true;
});

copyContextButton.addEventListener("click", async () => {
  if (!state.activeContext) {
    return;
  }
  const payload = buildContextExportPayload(state.activeContext);
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus("Document context copied to clipboard.", "ok");
  } catch (_error) {
    setStatus("Clipboard copy failed. Use export instead.", "warning");
  }
});

exportContextButton.addEventListener("click", () => {
  if (!state.activeContext) {
    return;
  }
  const payload = buildContextExportPayload(state.activeContext);
  const documentId = String(payload.document?.document_id || "document-context");
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${documentId}.context.json`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 0);
  setStatus("Document context exported.", "ok");
});

searchInput.addEventListener("input", handleSearchChanged);
chunkSearchInput.addEventListener("input", handleChunkSearchChanged);
typeFilter.addEventListener("change", onFilterChanged);
siteFilter.addEventListener("change", onFilterChanged);
fromDateInput.addEventListener("change", onFilterChanged);
toDateInput.addEventListener("change", onFilterChanged);
sortFieldSelect.addEventListener("change", onFilterChanged);
sortDirectionSelect.addEventListener("change", onFilterChanged);
pageSizeSelect.addEventListener("change", onFilterChanged);

prevPageButton.addEventListener("click", () => {
  state.page = Math.max(1, state.page - 1);
  renderLibrary();
  const selected = state.captures.find((capture) => capture._key === state.selectedKey);
  if (selected) {
    loadAndRenderDetail(selected).catch(() => undefined);
  }
});

nextPageButton.addEventListener("click", () => {
  state.page += 1;
  renderLibrary();
  const selected = state.captures.find((capture) => capture._key === state.selectedKey);
  if (selected) {
    loadAndRenderDetail(selected).catch(() => undefined);
  }
});

window.addEventListener("unload", () => {
  try {
    state.sqliteSession?.db?.close();
  } catch (_error) {
    // Ignore close errors during unload.
  }
});

window.addEventListener("hashchange", () => {
  loadDocumentContextForCurrentRoute().catch((error) => {
    setStatus(error?.message || "Failed to update document context route", "error");
  });
});

loadLibraryData().catch((error) => {
  setStatus(error?.message || "Failed to load capture library", "error");
});
