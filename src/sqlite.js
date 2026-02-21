import initSqlJs from "./vendor/sql-wasm.js";

export const DEFAULT_DB_NAME = "context-captures.sqlite";
export const SQLITE_DB_SCHEMA_VERSION = 4;
export const SQLITE_DB_SCHEMA_NAME = "graph_v4";

const MAX_OFFSET_SCAN_CHARS = 200000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const MAX_MIGRATION_HISTORY = 64;
const MIGRATION_BOOTSTRAP_V4 = "bootstrap_v4";
const MIGRATION_LEGACY_TO_V4 = "legacy_captures_to_v4";
const MIGRATION_ADD_CHUNK_INDEX = "chunk_index_backfill_v4";

let sqlJsPromise;

function encodeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

function decodeJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeIsoTimestamp(value, fallback = null) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isNaN(parsed)) {
    if (fallback) {
      return fallback;
    }
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function countWords(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter(Boolean).length;
}

function parseInteger(value, fallback = null) {
  const parsed = Number(value);
  if (Number.isInteger(parsed)) {
    return parsed;
  }
  return fallback;
}

function buildFallbackId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return buildFallbackId(prefix);
}

function clampInteger(value, fallback, max = MAX_LIST_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return 0;
  }
  return Math.min(normalized, max);
}

function normalizeHostnameFromUrl(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized).hostname.toLowerCase() || null;
  } catch (_error) {
    return null;
  }
}

function toSafeIdPart(value, fallback = "unknown") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function runSelectOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (!stmt.step()) {
      return null;
    }
    return stmt.getAsObject();
  } finally {
    stmt.free();
  }
}

function runSelectAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function buildWriteCloseError(target, writeError, closeError) {
  const writeMessage = writeError?.message || "write failed";
  const closeMessage = closeError?.message || "close failed";
  return new Error(
    `Failed while writing ${target}: ${writeMessage}. ` +
      `Also failed to close stream: ${closeMessage}.`
  );
}

function scalarValue(db, sql, params = []) {
  const row = runSelectOne(db, sql, params);
  if (!row) {
    return null;
  }
  const keys = Object.keys(row);
  if (!keys.length) {
    return null;
  }
  return row[keys[0]];
}

function tableExists(db, name) {
  const row = runSelectOne(
    db,
    `SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1;`,
    [name]
  );
  return Boolean(row?.name);
}

function getTableColumns(db, tableName) {
  if (!tableExists(db, tableName)) {
    return [];
  }
  const result = db.exec(`PRAGMA table_info(${tableName});`);
  return result?.[0]?.values?.map((row) => String(row[1])) || [];
}

function ensureColumnInTable(db, tableName, columnName, columnType, defaultExpression = null) {
  if (!tableExists(db, tableName)) {
    return;
  }
  const columns = getTableColumns(db, tableName);
  if (columns.includes(columnName)) {
    return;
  }
  const defaultClause = defaultExpression === null ? "" : ` DEFAULT ${defaultExpression}`;
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}${defaultClause};`);
}

function isLegacyCapturesTable(db, tableName = "captures") {
  const columns = getTableColumns(db, tableName);
  if (!columns.length) {
    return false;
  }
  return columns.includes("sourceUrl") && !columns.includes("capture_id");
}

function createMetaTable(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function getMetaValue(db, key) {
  if (!tableExists(db, "meta")) {
    return null;
  }
  const row = runSelectOne(db, `SELECT value FROM meta WHERE key = ? LIMIT 1;`, [key]);
  return row?.value ?? null;
}

function setMetaValue(db, key, value) {
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?);`, [
    String(key),
    value === undefined || value === null ? null : String(value)
  ]);
}

export function getDbSchemaVersion(db) {
  const raw = getMetaValue(db, "db_schema_version");
  if (raw === null) {
    return 0;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return 0;
  }
  return parsed;
}

export function setDbSchemaVersion(db, version) {
  setMetaValue(db, "db_schema_version", String(version));
}

function setDbSchemaName(db, schemaName = SQLITE_DB_SCHEMA_NAME) {
  setMetaValue(db, "db_schema_name", String(schemaName));
}

function recordMigration(db, migrationId, details = null) {
  const normalizedId = normalizeNullableString(migrationId);
  if (!normalizedId) {
    return;
  }

  const nowIso = new Date().toISOString();
  setMetaValue(db, "last_migration_id", normalizedId);
  setMetaValue(db, "last_migration_at", nowIso);

  const rawHistory = getMetaValue(db, "migration_history_json");
  const parsedHistory = decodeJson(rawHistory, []);
  const history = Array.isArray(parsedHistory) ? parsedHistory : [];
  const historyEntry = {
    id: normalizedId,
    at: nowIso,
    schema_version: SQLITE_DB_SCHEMA_VERSION,
    schema_name: SQLITE_DB_SCHEMA_NAME,
    details: details && typeof details === "object" ? details : null
  };

  const existingIndex = history.findIndex((item) => item?.id === normalizedId);
  if (existingIndex >= 0) {
    history[existingIndex] = historyEntry;
  } else {
    history.push(historyEntry);
  }

  if (history.length > MAX_MIGRATION_HISTORY) {
    history.splice(0, history.length - MAX_MIGRATION_HISTORY);
  }

  setMetaValue(db, "migration_history_json", encodeJson(history));
}

function ensureCoreTablesV2(db) {
  createMetaTable(db);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      canonical_url TEXT NULL,
      title TEXT NULL,
      site TEXT NULL,
      language TEXT NULL,
      published_at TEXT NULL,
      metadata_json TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS documents_site ON documents(site);`);
  db.run(`CREATE INDEX IF NOT EXISTS documents_published_at ON documents(published_at);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS captures (
      capture_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id),
      capture_type TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      content_hash TEXT NULL,
      document_text TEXT NULL,
      document_text_word_count INTEGER NULL,
      document_text_character_count INTEGER NULL,
      document_text_compressed_json TEXT NULL,
      transcript_text TEXT NULL,
      transcript_segments_json TEXT NULL,
      diagnostics_json TEXT NULL,
      legacy_record_json TEXT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS captures_saved_at ON captures(saved_at);`);
  db.run(`CREATE INDEX IF NOT EXISTS captures_capture_type ON captures(capture_type);`);
  db.run(`CREATE INDEX IF NOT EXISTS captures_document_id ON captures(document_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS captures_document_saved_at ON captures(document_id, saved_at);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id),
      capture_id TEXT NULL REFERENCES captures(capture_id),
      chunk_type TEXT NOT NULL CHECK (
        chunk_type IN ('document', 'highlight', 'note', 'transcript_segment')
      ),
      text TEXT NOT NULL,
      comment TEXT NULL,
      created_at TEXT NOT NULL,
      chunk_index INTEGER NULL,
      start_offset INTEGER NULL,
      end_offset INTEGER NULL,
      source_hash TEXT NULL,
      is_preview INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_document_id ON chunks(document_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_capture_id ON chunks(capture_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_chunk_type ON chunks(chunk_type);`);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_is_preview ON chunks(is_preview);`);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_document_created_at ON chunks(document_id, created_at);`);
  db.run(`CREATE INDEX IF NOT EXISTS chunks_capture_index ON chunks(capture_id, chunk_index);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS annotations (
      annotation_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id),
      capture_id TEXT NOT NULL REFERENCES captures(capture_id),
      annotation_type TEXT NOT NULL CHECK (annotation_type IN ('highlight', 'note')),
      selected_text TEXT NOT NULL,
      comment TEXT NULL,
      created_at TEXT NOT NULL,
      start_offset INTEGER NULL,
      end_offset INTEGER NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS annotations_document_id ON annotations(document_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS annotations_capture_id ON annotations(capture_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS annotations_type ON annotations(annotation_type);`);
  db.run(`CREATE INDEX IF NOT EXISTS annotations_document_created_at ON annotations(document_id, created_at);`);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS annotations_unique_capture_entry
    ON annotations(capture_id, annotation_type, selected_text, COALESCE(comment, ''), created_at);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transcript_segments (
      segment_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(document_id),
      capture_id TEXT NOT NULL REFERENCES captures(capture_id),
      segment_index INTEGER NOT NULL,
      timestamp_text TEXT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS transcript_segments_document_id ON transcript_segments(document_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS transcript_segments_capture_id ON transcript_segments(capture_id);`);
  db.run(
    `CREATE INDEX IF NOT EXISTS transcript_segments_document_capture_idx
      ON transcript_segments(document_id, capture_id, segment_index);`
  );
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS transcript_segments_capture_index
    ON transcript_segments(capture_id, segment_index);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      canonical_id TEXT NULL,
      properties_json TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS entities_name ON entities(name);`);
  db.run(`CREATE INDEX IF NOT EXISTS entities_entity_type ON entities(entity_type);`);
  db.run(`CREATE INDEX IF NOT EXISTS entities_canonical_id ON entities(canonical_id);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL REFERENCES entities(entity_id),
      alias TEXT NOT NULL,
      PRIMARY KEY (entity_id, alias)
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS entity_aliases_alias ON entity_aliases(alias);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS edges (
      edge_id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
      to_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
      predicate TEXT NOT NULL,
      confidence REAL NULL,
      properties_json TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS edges_from_entity_id ON edges(from_entity_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS edges_to_entity_id ON edges(to_entity_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS edges_predicate ON edges(predicate);`);
  db.run(`CREATE INDEX IF NOT EXISTS edges_created_at ON edges(created_at);`);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS edges_unique_relationship
    ON edges(from_entity_id, to_entity_id, predicate);
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS provenance (
      provenance_id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL CHECK (subject_type IN ('entity', 'edge')),
      subject_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id),
      evidence_text TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS provenance_subject ON provenance(subject_type, subject_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS provenance_chunk_id ON provenance(chunk_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS provenance_created_at ON provenance(created_at);`);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS provenance_unique_subject_chunk
    ON provenance(subject_type, subject_id, chunk_id);
  `);
}

function ensureSchemaColumnsV4(db) {
  ensureColumnInTable(db, "chunks", "is_preview", "INTEGER", "0");
  ensureColumnInTable(db, "chunks", "chunk_index", "INTEGER", null);
}

function backfillChunkIndexes(db) {
  if (!tableExists(db, "chunks")) {
    return 0;
  }

  const rows = runSelectAll(
    db,
    `
      SELECT chunk_id, capture_id, document_id
      FROM chunks
      ORDER BY
        capture_id ASC,
        created_at ASC,
        chunk_id ASC;
    `
  );
  if (rows.length === 0) {
    return 0;
  }

  const updateStmt = db.prepare(`UPDATE chunks SET chunk_index = ? WHERE chunk_id = ?;`);
  let previousGroup = null;
  let nextIndex = 0;
  let updated = 0;

  try {
    for (const row of rows) {
      const groupKey = `${row.capture_id || "no-capture"}::${row.document_id || "no-document"}`;
      if (groupKey !== previousGroup) {
        previousGroup = groupKey;
        nextIndex = 0;
      }
      updateStmt.run([nextIndex, row.chunk_id]);
      nextIndex += 1;
      updated += 1;
    }
  } finally {
    updateStmt.free();
  }

  return updated;
}

function pruneOrphanGraphRows(db) {
  db.run(`
    DELETE FROM entity_aliases
    WHERE entity_id NOT IN (SELECT entity_id FROM entities);
  `);
  db.run(`
    DELETE FROM edges
    WHERE from_entity_id NOT IN (SELECT entity_id FROM entities)
       OR to_entity_id NOT IN (SELECT entity_id FROM entities);
  `);
  db.run(`
    DELETE FROM provenance
    WHERE chunk_id NOT IN (SELECT chunk_id FROM chunks);
  `);
  db.run(`
    DELETE FROM provenance
    WHERE subject_type = 'entity'
      AND subject_id NOT IN (SELECT entity_id FROM entities);
  `);
  db.run(`
    DELETE FROM provenance
    WHERE subject_type = 'edge'
      AND subject_id NOT IN (SELECT edge_id FROM edges);
  `);
}

function hasFtsTable(db) {
  return tableExists(db, "chunks_fts");
}

export function ensureFtsIfPossible(db) {
  if (hasFtsTable(db)) {
    setMetaValue(db, "chunks_fts_enabled", "1");
    return true;
  }

  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
      USING fts5(
        chunk_id UNINDEXED,
        text,
        comment
      );
    `);
    setMetaValue(db, "chunks_fts_enabled", "1");
    return true;
  } catch (_error) {
    setMetaValue(db, "chunks_fts_enabled", "0");
    return false;
  }
}

function findSelectionBounds(documentText, selectedText) {
  if (!documentText || !selectedText) {
    return null;
  }

  const directStart = documentText.indexOf(selectedText);
  if (directStart >= 0) {
    return {
      start: directStart,
      end: directStart + selectedText.length
    };
  }

  const lowerDocument = documentText.toLowerCase();
  const lowerSelection = selectedText.toLowerCase();
  const lowerStart = lowerDocument.indexOf(lowerSelection);
  if (lowerStart >= 0) {
    return {
      start: lowerStart,
      end: lowerStart + selectedText.length
    };
  }

  const tokens = selectedText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (tokens.length < 2) {
    return null;
  }

  const first = tokens[0].toLowerCase();
  const last = tokens[tokens.length - 1].toLowerCase();
  let cursor = lowerDocument.indexOf(first);
  while (cursor >= 0) {
    const tail = lowerDocument.indexOf(last, cursor + first.length);
    if (tail < 0) {
      break;
    }
    if (tail - cursor <= Math.max(600, selectedText.length * 4)) {
      return {
        start: cursor,
        end: tail + tokens[tokens.length - 1].length
      };
    }
    cursor = lowerDocument.indexOf(first, cursor + 1);
  }

  return null;
}

function findChunkBoundary(text, start, maxEnd, minPreferredLength = 320) {
  if (maxEnd >= text.length) {
    return text.length;
  }

  const window = text.slice(start, maxEnd);
  const punctuationCandidates = [
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("。\n"),
    window.lastIndexOf("\n\n")
  ];
  const bestPunctuation = Math.max(...punctuationCandidates);
  if (bestPunctuation >= minPreferredLength) {
    return start + bestPunctuation + 1;
  }

  const whitespaceBoundary = window.lastIndexOf(" ");
  if (whitespaceBoundary >= Math.max(120, Math.floor(minPreferredLength / 2))) {
    return start + whitespaceBoundary;
  }

  return maxEnd;
}

function splitDocumentIntoChunks(documentText, maxChunkChars = 1600) {
  const text = String(documentText || "");
  if (!text.trim()) {
    return [];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    const maxEnd = Math.min(text.length, cursor + maxChunkChars);
    let end = findChunkBoundary(text, cursor, maxEnd);
    if (end <= cursor) {
      end = maxEnd;
    }

    let chunkText = text.slice(cursor, end);
    const leadingTrim = chunkText.match(/^\s*/)?.[0]?.length || 0;
    const trailingTrim = chunkText.match(/\s*$/)?.[0]?.length || 0;
    const startOffset = cursor + leadingTrim;
    const endOffset = Math.max(startOffset, end - trailingTrim);
    chunkText = chunkText.trim();

    if (chunkText) {
      chunks.push({
        start_offset: startOffset,
        end_offset: endOffset,
        text: chunkText
      });
    }

    cursor = end;
  }

  return chunks;
}

function sourceUrlForRecord(record) {
  const explicit = normalizeNullableString(record?.source?.url);
  if (explicit) {
    return explicit;
  }
  const recordId = normalizeNullableString(record?.id) || newId("capture");
  return `about:blank#capture-${recordId}`;
}

export function upsertDocument(db, record) {
  const nowIso = normalizeIsoTimestamp(record?.savedAt);
  const sourceMetadata = record?.source?.metadata && typeof record.source.metadata === "object"
    ? record.source.metadata
    : null;
  const url = sourceUrlForRecord(record);
  const existing = runSelectOne(db, `SELECT document_id FROM documents WHERE url = ? LIMIT 1;`, [url]);
  const documentId = existing?.document_id || newId("document");
  const canonicalUrl = normalizeNullableString(
    sourceMetadata?.canonicalUrl ?? sourceMetadata?.canonicalURL ?? null
  );

  db.run(
    `
      INSERT INTO documents (
        document_id,
        url,
        canonical_url,
        title,
        site,
        language,
        published_at,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        canonical_url = COALESCE(excluded.canonical_url, documents.canonical_url),
        title = COALESCE(excluded.title, documents.title),
        site = COALESCE(excluded.site, documents.site),
        language = COALESCE(excluded.language, documents.language),
        published_at = COALESCE(excluded.published_at, documents.published_at),
        metadata_json = COALESCE(excluded.metadata_json, documents.metadata_json);
    `,
    [
      documentId,
      url,
      canonicalUrl,
      normalizeNullableString(record?.source?.title),
      normalizeNullableString(record?.source?.site),
      normalizeNullableString(record?.source?.language),
      normalizeNullableString(record?.source?.publishedAt),
      encodeJson(sourceMetadata),
      nowIso
    ]
  );

  return documentId;
}

function annotationEntityIdForAnnotation(annotationId) {
  const normalized = normalizeNullableString(annotationId) || newId("annotation");
  return `entity:annotation:${normalized}`;
}

function clearAnnotationGraphForCapture(db, captureId) {
  const annotationEntityIds = runSelectAll(
    db,
    `
      SELECT 'entity:annotation:' || annotation_id AS entity_id
      FROM annotations
      WHERE capture_id = ?;
    `,
    [captureId]
  ).map((row) => row.entity_id);
  if (annotationEntityIds.length === 0) {
    return;
  }

  const deleteEdgeStmt = db.prepare(`
    DELETE FROM edges
    WHERE from_entity_id = ? OR to_entity_id = ?;
  `);
  const deleteEdgeProvenanceStmt = db.prepare(`
    DELETE FROM provenance
    WHERE subject_type = 'edge'
      AND subject_id IN (
        SELECT edge_id
        FROM edges
        WHERE from_entity_id = ? OR to_entity_id = ?
      );
  `);
  const deleteEntityProvenanceStmt = db.prepare(`
    DELETE FROM provenance
    WHERE subject_type = 'entity' AND subject_id = ?;
  `);
  const deleteAliasesStmt = db.prepare(`DELETE FROM entity_aliases WHERE entity_id = ?;`);
  const deleteEntityStmt = db.prepare(`DELETE FROM entities WHERE entity_id = ?;`);

  try {
    for (const entityId of annotationEntityIds) {
      deleteEdgeProvenanceStmt.run([entityId, entityId]);
      deleteEdgeStmt.run([entityId, entityId]);
      deleteEntityProvenanceStmt.run([entityId]);
      deleteAliasesStmt.run([entityId]);
      deleteEntityStmt.run([entityId]);
    }
  } finally {
    deleteEdgeStmt.free();
    deleteEdgeProvenanceStmt.free();
    deleteEntityProvenanceStmt.free();
    deleteAliasesStmt.free();
    deleteEntityStmt.free();
  }
}

function clearCaptureGraphForCapture(db, captureId) {
  const captureEntityId = `entity:capture:${captureId}`;
  db.run(
    `
      DELETE FROM provenance
      WHERE subject_type = 'edge'
        AND subject_id IN (
          SELECT edge_id
          FROM edges
          WHERE from_entity_id = ? OR to_entity_id = ?
        );
    `,
    [captureEntityId, captureEntityId]
  );
  db.run(
    `
      DELETE FROM edges
      WHERE from_entity_id = ? OR to_entity_id = ?;
    `,
    [captureEntityId, captureEntityId]
  );
  db.run(
    `DELETE FROM provenance WHERE subject_type = 'entity' AND subject_id = ?;`,
    [captureEntityId]
  );
}

function clearChunksForCapture(db, captureId) {
  if (!captureId) {
    return;
  }

  clearCaptureGraphForCapture(db, captureId);
  clearAnnotationGraphForCapture(db, captureId);
  db.run(`DELETE FROM annotations WHERE capture_id = ?;`, [captureId]);
  db.run(`DELETE FROM transcript_segments WHERE capture_id = ?;`, [captureId]);
  db.run(
    `DELETE FROM provenance WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE capture_id = ?);`,
    [captureId]
  );
  if (hasFtsTable(db)) {
    db.run(
      `DELETE FROM chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE capture_id = ?);`,
      [captureId]
    );
  }
  db.run(`DELETE FROM chunks WHERE capture_id = ?;`, [captureId]);
}

export function insertCaptureV2(db, record, documentId) {
  const captureId = normalizeNullableString(record?.id) || newId("capture");
  clearChunksForCapture(db, captureId);

  const content = record?.content || {};
  const documentText =
    content.documentText === undefined || content.documentText === null
      ? null
      : String(content.documentText);
  const transcriptText =
    content.transcriptText === undefined || content.transcriptText === null
      ? null
      : String(content.transcriptText);
  const parsedWordCount = parseInteger(content.documentTextWordCount, null);
  const parsedCharCount = parseInteger(content.documentTextCharacterCount, null);
  const wordCount =
    parsedWordCount !== null && parsedWordCount >= 0
      ? parsedWordCount
      : countWords(documentText || "");
  const charCount =
    parsedCharCount !== null && parsedCharCount >= 0
      ? parsedCharCount
      : String(documentText || "").length;
  const shouldStoreLegacyRecord = record?.__persistLegacyRecord === true;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO captures (
      capture_id,
      document_id,
      capture_type,
      saved_at,
      content_hash,
      document_text,
      document_text_word_count,
      document_text_character_count,
      document_text_compressed_json,
      transcript_text,
      transcript_segments_json,
      diagnostics_json,
      legacy_record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  try {
    stmt.run([
      captureId,
      documentId,
      normalizeNullableString(record?.captureType) || "selected_text",
      normalizeIsoTimestamp(record?.savedAt),
      normalizeNullableString(content.contentHash),
      documentText,
      wordCount,
      charCount,
      encodeJson(content.documentTextCompressed ?? null),
      transcriptText,
      encodeJson(content.transcriptSegments ?? null),
      encodeJson(record?.diagnostics ?? null),
      shouldStoreLegacyRecord ? encodeJson(record ?? null) : null
    ]);
  } finally {
    stmt.free();
  }

  return captureId;
}

function buildChunkRows(record, documentId, captureId) {
  const rows = [];
  const annotations = [];
  const transcriptSegments = [];
  let chunkCursor = 0;
  const savedAt = normalizeIsoTimestamp(record?.savedAt);
  const content = record?.content || {};
  const documentText = typeof content.documentText === "string" ? content.documentText : null;

  if (documentText && documentText.trim()) {
    const parsedChunks = splitDocumentIntoChunks(documentText);
    for (let index = 0; index < parsedChunks.length; index += 1) {
      const parsed = parsedChunks[index];
      rows.push({
        chunk_id: `${captureId}:document:${index}`,
        document_id: documentId,
        capture_id: captureId,
        chunk_type: "document",
        text: parsed.text,
        comment: null,
        created_at: savedAt,
        chunk_index: chunkCursor,
        start_offset: parsed.start_offset,
        end_offset: parsed.end_offset,
        source_hash: normalizeNullableString(content.contentHash),
        is_preview: 0,
        search_text: parsed.text
      });
      chunkCursor += 1;
    }
  }

  const scanOffsets = Boolean(documentText) && documentText.length <= MAX_OFFSET_SCAN_CHARS;
  const rawAnnotations = Array.isArray(content.annotations) ? content.annotations : [];
  let annotationIndex = 0;
  for (const annotation of rawAnnotations) {
    const selectedText =
      annotation?.selectedText === undefined || annotation?.selectedText === null
        ? ""
        : String(annotation.selectedText);
    const comment = normalizeNullableString(annotation?.comment);
    if (!selectedText && !comment) {
      continue;
    }
    const chunkText = selectedText || comment || "";

    let startOffset = null;
    let endOffset = null;
    if (scanOffsets && selectedText.trim()) {
      const bounds = findSelectionBounds(documentText, selectedText.trim());
      if (bounds) {
        startOffset = bounds.start;
        endOffset = bounds.end;
      }
    }

    const chunkType = comment ? "note" : "highlight";
    const annotationId = `${captureId}:annotation:${annotationIndex}`;
    annotations.push({
      annotation_id: annotationId,
      document_id: documentId,
      capture_id: captureId,
      annotation_type: chunkType,
      selected_text: selectedText,
      comment,
      created_at: normalizeIsoTimestamp(annotation?.createdAt, savedAt),
      start_offset: startOffset,
      end_offset: endOffset
    });
    rows.push({
      chunk_id: annotationId,
      document_id: documentId,
      capture_id: captureId,
      chunk_type: chunkType,
      text: chunkText,
      comment,
      created_at: normalizeIsoTimestamp(annotation?.createdAt, savedAt),
      chunk_index: chunkCursor,
      start_offset: startOffset,
      end_offset: endOffset,
      source_hash: null,
      is_preview: 0,
      search_text: chunkText
    });
    chunkCursor += 1;
    annotationIndex += 1;
  }

  const rawTranscriptSegments = Array.isArray(content.transcriptSegments)
    ? content.transcriptSegments
    : [];
  let transcriptIndex = 0;
  for (const segment of rawTranscriptSegments) {
    const text = String(segment?.text || "").trim();
    if (!text) {
      continue;
    }
    const segmentId = `${captureId}:transcript:${transcriptIndex}`;
    transcriptSegments.push({
      segment_id: segmentId,
      document_id: documentId,
      capture_id: captureId,
      segment_index: transcriptIndex,
      timestamp_text: normalizeNullableString(segment?.timestamp),
      text,
      created_at: savedAt
    });
    rows.push({
      chunk_id: segmentId,
      document_id: documentId,
      capture_id: captureId,
      chunk_type: "transcript_segment",
      text,
      comment: null,
      created_at: savedAt,
      chunk_index: chunkCursor,
      start_offset: null,
      end_offset: null,
      source_hash: null,
      is_preview: 0,
      search_text: text
    });
    chunkCursor += 1;
    transcriptIndex += 1;
  }

  return {
    chunkRows: rows,
    annotationRows: annotations,
    transcriptSegmentRows: transcriptSegments
  };
}

export function buildJsonChunksForRecord(record, options = {}) {
  const captureId =
    normalizeNullableString(options.captureId) || normalizeNullableString(record?.id) || newId("capture");
  const documentId = normalizeNullableString(options.documentId) || "json-document";
  const { chunkRows } = buildChunkRows(record, documentId, captureId);

  return chunkRows.map((row) => ({
    chunkId: row.chunk_id,
    captureId,
    chunkType: row.chunk_type,
    text: row.text ?? "",
    comment: row.comment ?? null,
    createdAt: row.created_at,
    chunkIndex: row.chunk_index ?? null,
    startOffset: row.start_offset ?? null,
    endOffset: row.end_offset ?? null,
    sourceHash: row.source_hash ?? null
  }));
}

export function syncFtsRows(db, chunkRows) {
  if (!hasFtsTable(db) || !Array.isArray(chunkRows) || chunkRows.length === 0) {
    return;
  }

  const deleteStmt = db.prepare(`DELETE FROM chunks_fts WHERE chunk_id = ?;`);
  const insertStmt = db.prepare(
    `INSERT INTO chunks_fts (chunk_id, text, comment) VALUES (?, ?, ?);`
  );

  try {
    for (const row of chunkRows) {
      deleteStmt.run([row.chunk_id]);
      insertStmt.run([row.chunk_id, row.search_text || row.text || "", row.comment || ""]);
    }
  } finally {
    deleteStmt.free();
    insertStmt.free();
  }
}

function rebuildFtsFromChunks(db) {
  if (!hasFtsTable(db) || !tableExists(db, "chunks")) {
    return 0;
  }

  const rows = runSelectAll(
    db,
    `
      SELECT
        c.chunk_id,
        c.text,
        c.comment
      FROM chunks c
      ;
    `
  );

  db.run(`DELETE FROM chunks_fts;`);
  if (rows.length === 0) {
    return 0;
  }

  const stmt = db.prepare(`INSERT INTO chunks_fts (chunk_id, text, comment) VALUES (?, ?, ?);`);
  try {
    for (const row of rows) {
      stmt.run([row.chunk_id, row.text || "", row.comment || ""]);
    }
  } finally {
    stmt.free();
  }
  return rows.length;
}

export function insertChunksV2(db, chunkRows) {
  if (!Array.isArray(chunkRows) || chunkRows.length === 0) {
    return;
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (
      chunk_id,
      document_id,
      capture_id,
      chunk_type,
      text,
      comment,
      created_at,
      chunk_index,
      start_offset,
      end_offset,
      source_hash,
      is_preview
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  try {
    for (const row of chunkRows) {
      stmt.run([
        row.chunk_id,
        row.document_id,
        row.capture_id,
        row.chunk_type,
        row.text ?? "",
        row.comment ?? null,
        row.created_at,
        row.chunk_index ?? null,
        row.start_offset ?? null,
        row.end_offset ?? null,
        row.source_hash ?? null,
        row.is_preview ?? 0
      ]);
    }
  } finally {
    stmt.free();
  }

  syncFtsRows(db, chunkRows);
}

function insertAnnotationRows(db, annotationRows) {
  if (!Array.isArray(annotationRows) || annotationRows.length === 0) {
    return;
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO annotations (
      annotation_id,
      document_id,
      capture_id,
      annotation_type,
      selected_text,
      comment,
      created_at,
      start_offset,
      end_offset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  try {
    for (const row of annotationRows) {
      stmt.run([
        row.annotation_id,
        row.document_id,
        row.capture_id,
        row.annotation_type,
        row.selected_text,
        row.comment ?? null,
        row.created_at,
        row.start_offset ?? null,
        row.end_offset ?? null
      ]);
    }
  } finally {
    stmt.free();
  }
}

function insertTranscriptSegmentRows(db, segmentRows) {
  if (!Array.isArray(segmentRows) || segmentRows.length === 0) {
    return;
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO transcript_segments (
      segment_id,
      document_id,
      capture_id,
      segment_index,
      timestamp_text,
      text,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?);
  `);

  try {
    for (const row of segmentRows) {
      stmt.run([
        row.segment_id,
        row.document_id,
        row.capture_id,
        row.segment_index,
        row.timestamp_text ?? null,
        row.text,
        row.created_at
      ]);
    }
  } finally {
    stmt.free();
  }
}

function upsertEntity(db, entity) {
  const entityId = normalizeNullableString(entity?.entity_id) || newId("entity");
  const createdAt = normalizeIsoTimestamp(entity?.created_at);
  db.run(
    `
      INSERT INTO entities (
        entity_id,
        entity_type,
        name,
        canonical_id,
        properties_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        entity_type = COALESCE(excluded.entity_type, entities.entity_type),
        name = COALESCE(excluded.name, entities.name),
        canonical_id = COALESCE(excluded.canonical_id, entities.canonical_id),
        properties_json = COALESCE(excluded.properties_json, entities.properties_json);
    `,
    [
      entityId,
      normalizeNullableString(entity?.entity_type) || "unknown",
      normalizeNullableString(entity?.name) || entityId,
      normalizeNullableString(entity?.canonical_id),
      encodeJson(entity?.properties_json ?? entity?.properties ?? null),
      createdAt
    ]
  );
  return entityId;
}

function upsertEntityAlias(db, entityId, alias) {
  const normalizedAlias = normalizeNullableString(alias);
  if (!entityId || !normalizedAlias) {
    return;
  }
  db.run(
    `INSERT OR IGNORE INTO entity_aliases (entity_id, alias) VALUES (?, ?);`,
    [entityId, normalizedAlias]
  );
}

function upsertEdge(db, edge) {
  const fromEntityId = normalizeNullableString(edge?.from_entity_id);
  const toEntityId = normalizeNullableString(edge?.to_entity_id);
  const predicate = normalizeNullableString(edge?.predicate);
  if (!fromEntityId || !toEntityId || !predicate) {
    return null;
  }

  const edgeId =
    normalizeNullableString(edge?.edge_id) ||
    `edge:${toSafeIdPart(fromEntityId)}:${toSafeIdPart(predicate)}:${toSafeIdPart(toEntityId)}`;
  db.run(
    `
      INSERT INTO edges (
        edge_id,
        from_entity_id,
        to_entity_id,
        predicate,
        confidence,
        properties_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_entity_id, to_entity_id, predicate) DO UPDATE SET
        confidence = COALESCE(excluded.confidence, edges.confidence),
        properties_json = COALESCE(excluded.properties_json, edges.properties_json);
    `,
    [
      edgeId,
      fromEntityId,
      toEntityId,
      predicate,
      edge?.confidence ?? null,
      encodeJson(edge?.properties_json ?? edge?.properties ?? null),
      normalizeIsoTimestamp(edge?.created_at)
    ]
  );
  const row = runSelectOne(
    db,
    `
      SELECT edge_id
      FROM edges
      WHERE from_entity_id = ? AND to_entity_id = ? AND predicate = ?
      LIMIT 1;
    `,
    [fromEntityId, toEntityId, predicate]
  );
  return row?.edge_id || edgeId;
}

function upsertProvenance(db, provenance) {
  const subjectType = normalizeNullableString(provenance?.subject_type);
  const subjectId = normalizeNullableString(provenance?.subject_id);
  const chunkId = normalizeNullableString(provenance?.chunk_id);
  if (!subjectType || !subjectId || !chunkId) {
    return null;
  }

  const provenanceId =
    normalizeNullableString(provenance?.provenance_id) ||
    `prov:${toSafeIdPart(subjectType)}:${toSafeIdPart(subjectId)}:${toSafeIdPart(chunkId)}`;
  db.run(
    `
      INSERT INTO provenance (
        provenance_id,
        subject_type,
        subject_id,
        chunk_id,
        evidence_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_type, subject_id, chunk_id) DO UPDATE SET
        evidence_text = COALESCE(excluded.evidence_text, provenance.evidence_text);
    `,
    [
      provenanceId,
      subjectType,
      subjectId,
      chunkId,
      normalizeNullableString(provenance?.evidence_text),
      normalizeIsoTimestamp(provenance?.created_at)
    ]
  );
  const row = runSelectOne(
    db,
    `
      SELECT provenance_id
      FROM provenance
      WHERE subject_type = ? AND subject_id = ? AND chunk_id = ?
      LIMIT 1;
    `,
    [subjectType, subjectId, chunkId]
  );
  return row?.provenance_id || provenanceId;
}

function populateGraphForCapture(db, record, documentId, captureId, chunkRows, annotationRows = []) {
  const chunkIds = new Set(Array.isArray(chunkRows) ? chunkRows.map((row) => row.chunk_id) : []);
  const savedAt = normalizeIsoTimestamp(record?.savedAt);
  const sourceUrl = sourceUrlForRecord(record);
  const sourceSite = normalizeNullableString(record?.source?.site);
  const sourceTitle = normalizeNullableString(record?.source?.title) || sourceUrl;
  const hostname = normalizeHostnameFromUrl(sourceUrl);

  const documentEntityId = upsertEntity(db, {
    entity_id: `entity:document:${documentId}`,
    entity_type: "document",
    name: sourceTitle,
    canonical_id: sourceUrl,
    properties: {
      document_id: documentId,
      url: sourceUrl,
      title: sourceTitle,
      site: sourceSite,
      language: normalizeNullableString(record?.source?.language),
      published_at: normalizeNullableString(record?.source?.publishedAt)
    },
    created_at: savedAt
  });
  upsertEntityAlias(db, documentEntityId, sourceUrl);
  upsertEntityAlias(db, documentEntityId, sourceTitle);

  const captureType = normalizeNullableString(record?.captureType) || "selected_text";
  const captureEntityId = upsertEntity(db, {
    entity_id: `entity:capture:${captureId}`,
    entity_type: "capture",
    name: captureId,
    canonical_id: captureId,
    properties: {
      capture_id: captureId,
      capture_type: captureType,
      saved_at: savedAt,
      document_id: documentId
    },
    created_at: savedAt
  });

  const captureTypeEntityId = upsertEntity(db, {
    entity_id: `entity:capture_type:${toSafeIdPart(captureType)}`,
    entity_type: "capture_type",
    name: captureType,
    canonical_id: captureType,
    properties: null,
    created_at: savedAt
  });

  let siteEntityId = null;
  if (sourceSite || hostname) {
    const siteName = sourceSite || hostname;
    siteEntityId = upsertEntity(db, {
      entity_id: `entity:site:${toSafeIdPart(siteName)}`,
      entity_type: "site",
      name: siteName,
      canonical_id: hostname || siteName,
      properties: {
        site: sourceSite,
        hostname
      },
      created_at: savedAt
    });
    upsertEntityAlias(db, siteEntityId, siteName);
    if (hostname && hostname !== siteName) {
      upsertEntityAlias(db, siteEntityId, hostname);
    }
  }

  const provenanceChunk =
    chunkRows.find((row) => row.chunk_type === "document") ||
    chunkRows[0] ||
    null;
  const provenanceChunkId = provenanceChunk?.chunk_id || null;
  const evidenceText = provenanceChunk?.text || null;

  const documentToCaptureEdgeId = upsertEdge(db, {
    edge_id: `edge:document_capture:${toSafeIdPart(documentId)}:${toSafeIdPart(captureId)}`,
    from_entity_id: documentEntityId,
    to_entity_id: captureEntityId,
    predicate: "captured_as",
    confidence: 1,
    properties: {
      capture_type: captureType
    },
    created_at: savedAt
  });
  const captureTypeEdgeId = upsertEdge(db, {
    edge_id: `edge:capture_type:${toSafeIdPart(captureId)}:${toSafeIdPart(captureType)}`,
    from_entity_id: captureEntityId,
    to_entity_id: captureTypeEntityId,
    predicate: "has_capture_type",
    confidence: 1,
    properties: null,
    created_at: savedAt
  });
  let siteToDocumentEdgeId = null;
  if (siteEntityId) {
    siteToDocumentEdgeId = upsertEdge(db, {
      edge_id: `edge:site_document:${toSafeIdPart(siteEntityId)}:${toSafeIdPart(documentId)}`,
      from_entity_id: siteEntityId,
      to_entity_id: documentEntityId,
      predicate: "hosts_document",
      confidence: 0.95,
      properties: null,
      created_at: savedAt
    });
  }

  if (provenanceChunkId) {
    upsertProvenance(db, {
      subject_type: "entity",
      subject_id: documentEntityId,
      chunk_id: provenanceChunkId,
      evidence_text: evidenceText,
      created_at: savedAt
    });
    if (siteEntityId) {
      upsertProvenance(db, {
        subject_type: "entity",
        subject_id: siteEntityId,
        chunk_id: provenanceChunkId,
        evidence_text: evidenceText,
        created_at: savedAt
      });
    }
    if (captureEntityId) {
      upsertProvenance(db, {
        subject_type: "entity",
        subject_id: captureEntityId,
        chunk_id: provenanceChunkId,
        evidence_text: evidenceText,
        created_at: savedAt
      });
    }
    for (const edgeId of [documentToCaptureEdgeId, captureTypeEdgeId, siteToDocumentEdgeId]) {
      if (!edgeId) {
        continue;
      }
      upsertProvenance(db, {
        subject_type: "edge",
        subject_id: edgeId,
        chunk_id: provenanceChunkId,
        evidence_text: evidenceText,
        created_at: savedAt
      });
    }
  }

  for (const annotation of annotationRows) {
    const annotationId = annotation.annotation_id;
    if (!chunkIds.has(annotationId)) {
      continue;
    }
    const annotationEntityId = upsertEntity(db, {
      entity_id: annotationEntityIdForAnnotation(annotationId),
      entity_type: "annotation",
      name: String(annotation.selected_text || "").slice(0, 240) || annotationId,
      canonical_id: annotationId,
      properties: {
        annotation_id: annotationId,
        annotation_type: annotation.annotation_type,
        capture_id: captureId,
        document_id: documentId,
        comment: annotation.comment ?? null,
        start_offset: annotation.start_offset ?? null,
        end_offset: annotation.end_offset ?? null
      },
      created_at: normalizeIsoTimestamp(annotation.created_at, savedAt)
    });
    upsertEntityAlias(db, annotationEntityId, annotation.selected_text);
    if (annotation.comment) {
      upsertEntityAlias(db, annotationEntityId, annotation.comment);
    }

    const documentToAnnotationEdgeId = upsertEdge(db, {
      edge_id: `edge:document_annotation:${toSafeIdPart(documentId)}:${toSafeIdPart(annotationId)}`,
      from_entity_id: documentEntityId,
      to_entity_id: annotationEntityId,
      predicate: "has_annotation",
      confidence: 1,
      properties: {
        annotation_type: annotation.annotation_type
      },
      created_at: normalizeIsoTimestamp(annotation.created_at, savedAt)
    });
    const captureToAnnotationEdgeId = upsertEdge(db, {
      edge_id: `edge:capture_annotation:${toSafeIdPart(captureId)}:${toSafeIdPart(annotationId)}`,
      from_entity_id: captureEntityId,
      to_entity_id: annotationEntityId,
      predicate: "captured_annotation",
      confidence: 1,
      properties: {
        annotation_type: annotation.annotation_type
      },
      created_at: normalizeIsoTimestamp(annotation.created_at, savedAt)
    });

    upsertProvenance(db, {
      subject_type: "entity",
      subject_id: annotationEntityId,
      chunk_id: annotationId,
      evidence_text: annotation.selected_text,
      created_at: normalizeIsoTimestamp(annotation.created_at, savedAt)
    });
    for (const edgeId of [documentToAnnotationEdgeId, captureToAnnotationEdgeId]) {
      if (!edgeId) {
        continue;
      }
      upsertProvenance(db, {
        subject_type: "edge",
        subject_id: edgeId,
        chunk_id: annotationId,
        evidence_text: annotation.selected_text,
        created_at: normalizeIsoTimestamp(annotation.created_at, savedAt)
      });
    }
  }
}

function persistRecordGraph(db, record) {
  const documentId = upsertDocument(db, record);
  const captureId = insertCaptureV2(db, record, documentId);
  const { chunkRows, annotationRows, transcriptSegmentRows } = buildChunkRows(
    record,
    documentId,
    captureId
  );
  insertChunksV2(db, chunkRows);
  insertAnnotationRows(db, annotationRows);
  insertTranscriptSegmentRows(db, transcriptSegmentRows);
  populateGraphForCapture(db, record, documentId, captureId, chunkRows, annotationRows);

  return {
    documentId,
    captureId,
    chunkCount: chunkRows.length,
    annotationCount: annotationRows.length,
    transcriptSegmentCount: transcriptSegmentRows.length
  };
}

function mergeLegacyAnnotations(annotations, selectedText, comment, savedAt) {
  const merged = [];
  const seen = new Set();

  const push = (item) => {
    const text = item?.selectedText === undefined || item?.selectedText === null
      ? ""
      : String(item.selectedText);
    const note = normalizeNullableString(item?.comment);
    if (!text && !note) {
      return;
    }
    const key = `${text}\u241f${note || ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push({
      selectedText: text,
      comment: note,
      createdAt: normalizeIsoTimestamp(item?.createdAt, savedAt)
    });
  };

  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      push(annotation);
    }
  }

  if (selectedText || comment) {
    push({
      selectedText: selectedText || "",
      comment: comment || null,
      createdAt: savedAt
    });
  }

  return merged.length ? merged : null;
}

function mapLegacyRowToRecord(row) {
  const id = normalizeNullableString(row?.id) || newId("capture");
  const savedAt = normalizeIsoTimestamp(row?.savedAt);
  const metadata = decodeJson(row?.sourceMetadata, {});
  const documentText =
    row?.documentText === undefined || row?.documentText === null ? null : String(row.documentText);
  const annotations = mergeLegacyAnnotations(
    decodeJson(row?.annotations, null),
    normalizeNullableString(row?.selectedText) || "",
    normalizeNullableString(row?.comment),
    savedAt
  );
  const transcriptSegments = decodeJson(row?.transcriptSegments, null);

  return {
    id,
    schemaVersion: normalizeNullableString(row?.schemaVersion) || "legacy",
    captureType: normalizeNullableString(row?.captureType) || "selected_text",
    savedAt,
    source: {
      url: normalizeNullableString(row?.sourceUrl) || `about:blank#legacy-${id}`,
      title: normalizeNullableString(row?.sourceTitle),
      site: normalizeNullableString(row?.sourceSite),
      language: normalizeNullableString(row?.sourceLanguage),
      publishedAt: normalizeNullableString(row?.sourcePublishedAt),
      metadata: metadata && typeof metadata === "object" ? metadata : {}
    },
    content: {
      documentText,
      documentTextWordCount: parseInteger(row?.documentTextWordCount, countWords(documentText || "")),
      documentTextCharacterCount: parseInteger(
        row?.documentTextCharacterCount,
        String(documentText || "").length
      ),
      contentHash: normalizeNullableString(row?.contentHash),
      documentTextCompressed: decodeJson(row?.documentTextCompressed, null),
      annotations,
      transcriptText: row?.transcriptText === undefined ? null : row.transcriptText,
      transcriptSegments: Array.isArray(transcriptSegments) ? transcriptSegments : null
    },
    diagnostics: decodeJson(row?.diagnostics, null)
  };
}

function backfillDerivedTablesFromExistingCaptures(db) {
  if (!tableExists(db, "captures") || !tableExists(db, "documents") || !tableExists(db, "chunks")) {
    return {
      annotationsBackfilled: 0,
      transcriptSegmentsBackfilled: 0,
      graphBackfilled: 0
    };
  }

  const captures = runSelectAll(
    db,
    `
      SELECT
        c.capture_id,
        c.capture_type,
        c.saved_at,
        c.transcript_segments_json,
        d.document_id,
        d.url,
        d.title,
        d.site,
        d.language,
        d.published_at
      FROM captures c
      INNER JOIN documents d ON d.document_id = c.document_id;
    `
  );

  let annotationsBackfilled = 0;
  let transcriptSegmentsBackfilled = 0;
  let graphBackfilled = 0;

  for (const capture of captures) {
    const captureId = capture.capture_id;
    const documentId = capture.document_id;
    const savedAt = normalizeIsoTimestamp(capture.saved_at);

    const existingAnnotationCount = Number(
      scalarValue(
        db,
        `SELECT COUNT(*) FROM annotations WHERE capture_id = ?;`,
        [captureId]
      ) || 0
    );
    if (existingAnnotationCount === 0) {
      const noteChunks = runSelectAll(
        db,
        `
          SELECT chunk_id, chunk_type, text, comment, created_at, start_offset, end_offset
          FROM chunks
          WHERE capture_id = ? AND chunk_type IN ('highlight', 'note')
          ORDER BY
            CASE WHEN chunk_index IS NULL THEN 1 ELSE 0 END ASC,
            chunk_index ASC,
            created_at ASC,
            chunk_id ASC;
        `,
        [captureId]
      );
      if (noteChunks.length > 0) {
        const annotationRows = noteChunks.map((row, index) => ({
          annotation_id: `${captureId}:annotation:backfill:${index}`,
          document_id: documentId,
          capture_id: captureId,
          annotation_type: row.chunk_type === "note" ? "note" : "highlight",
          selected_text: String(row.text || ""),
          comment: normalizeNullableString(row.comment),
          created_at: normalizeIsoTimestamp(row.created_at, savedAt),
          start_offset: row.start_offset ?? null,
          end_offset: row.end_offset ?? null
        }));
        insertAnnotationRows(db, annotationRows);
        annotationsBackfilled += annotationRows.length;
      }
    }

    const existingSegmentCount = Number(
      scalarValue(
        db,
        `SELECT COUNT(*) FROM transcript_segments WHERE capture_id = ?;`,
        [captureId]
      ) || 0
    );
    if (existingSegmentCount === 0) {
      let rowsToInsert = [];
      const fromJson = decodeJson(capture.transcript_segments_json, null);
      if (Array.isArray(fromJson) && fromJson.length > 0) {
        rowsToInsert = fromJson
          .map((segment, index) => ({
            segment_id: `${captureId}:transcript:backfill:${index}`,
            document_id: documentId,
            capture_id: captureId,
            segment_index: index,
            timestamp_text: normalizeNullableString(segment?.timestamp),
            text: String(segment?.text || "").trim(),
            created_at: savedAt
          }))
          .filter((row) => row.text);
      } else {
        const chunkSegments = runSelectAll(
          db,
          `
            SELECT chunk_id, text, created_at
            FROM chunks
            WHERE capture_id = ? AND chunk_type = 'transcript_segment'
            ORDER BY
              CASE WHEN chunk_index IS NULL THEN 1 ELSE 0 END ASC,
              chunk_index ASC,
              created_at ASC,
              chunk_id ASC;
          `,
          [captureId]
        );
        rowsToInsert = chunkSegments
          .map((segment, index) => ({
            segment_id: `${captureId}:transcript:backfill:${index}`,
            document_id: documentId,
            capture_id: captureId,
            segment_index: index,
            timestamp_text: null,
            text: String(segment?.text || "").trim(),
            created_at: normalizeIsoTimestamp(segment?.created_at, savedAt)
          }))
          .filter((row) => row.text);
      }

      if (rowsToInsert.length > 0) {
        insertTranscriptSegmentRows(db, rowsToInsert);
        transcriptSegmentsBackfilled += rowsToInsert.length;
      }
    }

    const chunkRows = runSelectAll(
      db,
      `
        SELECT *
        FROM chunks
        WHERE capture_id = ?
        ORDER BY
          CASE WHEN chunk_index IS NULL THEN 1 ELSE 0 END ASC,
          chunk_index ASC,
          created_at ASC,
          chunk_id ASC;
      `,
      [captureId]
    ).map((row) => ({
      ...row,
      search_text: row.text
    }));

    if (chunkRows.length > 0) {
      const recordView = {
        captureType: capture.capture_type,
        savedAt,
        source: {
          url: capture.url,
          title: capture.title,
          site: capture.site,
          language: capture.language,
          publishedAt: capture.published_at
        }
      };
      const annotationRows = runSelectAll(
        db,
        `
          SELECT *
          FROM annotations
          WHERE capture_id = ?
          ORDER BY created_at ASC, annotation_id ASC;
        `,
        [captureId]
      );
      populateGraphForCapture(db, recordView, documentId, captureId, chunkRows, annotationRows);
      graphBackfilled += 1;
    }
  }

  return {
    annotationsBackfilled,
    transcriptSegmentsBackfilled,
    graphBackfilled
  };
}

export function saveRecordToDbV2(db, record, options = {}) {
  const ensureSchema = options.ensureSchema !== false;
  const useTransaction = options.useTransaction !== false;

  if (ensureSchema) {
    ensureSchemaV2(db);
  }

  if (!useTransaction) {
    return persistRecordGraph(db, record);
  }

  db.run("BEGIN;");
  try {
    const result = persistRecordGraph(db, record);
    db.run("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.run("ROLLBACK;");
    } catch (_rollbackError) {
      // Ignore rollback errors and surface original write failure.
    }
    throw error;
  }
}

export function migrateLegacyToV2(db) {
  db.run("PRAGMA foreign_keys = ON;");
  createMetaTable(db);
  const schemaVersionBefore = getDbSchemaVersion(db);

  const hasLegacyNamedCaptures = isLegacyCapturesTable(db, "captures");
  const hasLegacyArchive = isLegacyCapturesTable(db, "captures_legacy");

  if (!hasLegacyNamedCaptures && !hasLegacyArchive) {
    ensureCoreTablesV2(db);
    ensureSchemaColumnsV4(db);
    const hadFts = hasFtsTable(db);
    const hasFts = ensureFtsIfPossible(db);
    backfillDerivedTablesFromExistingCaptures(db);
    const chunkIndexesBackfilled = backfillChunkIndexes(db);
    pruneOrphanGraphRows(db);
    if (hasFts) {
      if (!hadFts || Number(scalarValue(db, `SELECT COUNT(*) FROM chunks_fts;`) || 0) === 0) {
        rebuildFtsFromChunks(db);
      }
    }
    setMetaValue(db, "backfill_chunk_indexes", String(chunkIndexesBackfilled));
    setDbSchemaName(db, SQLITE_DB_SCHEMA_NAME);
    setDbSchemaVersion(db, SQLITE_DB_SCHEMA_VERSION);
    if (schemaVersionBefore < SQLITE_DB_SCHEMA_VERSION) {
      recordMigration(db, schemaVersionBefore === 0 ? MIGRATION_BOOTSTRAP_V4 : MIGRATION_ADD_CHUNK_INDEX, {
        legacy_rows_migrated: 0,
        chunk_indexes_backfilled: chunkIndexesBackfilled
      });
    }
    return 0;
  }

  db.run("BEGIN;");
  try {
    if (hasLegacyNamedCaptures && !tableExists(db, "captures_legacy")) {
      db.run(`ALTER TABLE captures RENAME TO captures_legacy;`);
    }

    ensureCoreTablesV2(db);
    ensureSchemaColumnsV4(db);
    const hadFts = hasFtsTable(db);
    const hasFts = ensureFtsIfPossible(db);

    let migrated = 0;
    if (tableExists(db, "captures_legacy")) {
      const stmt = db.prepare(`SELECT * FROM captures_legacy;`);
      try {
        while (stmt.step()) {
          const legacyRow = stmt.getAsObject();
          const record = mapLegacyRowToRecord(legacyRow);
          saveRecordToDbV2(db, record, { ensureSchema: false, useTransaction: false });
          migrated += 1;
        }
      } finally {
        stmt.free();
      }
    }

    backfillDerivedTablesFromExistingCaptures(db);
    const chunkIndexesBackfilled = backfillChunkIndexes(db);
    pruneOrphanGraphRows(db);
    if (hasFts) {
      if (!hadFts || Number(scalarValue(db, `SELECT COUNT(*) FROM chunks_fts;`) || 0) === 0) {
        rebuildFtsFromChunks(db);
      }
    }
    setDbSchemaName(db, SQLITE_DB_SCHEMA_NAME);
    setDbSchemaVersion(db, SQLITE_DB_SCHEMA_VERSION);
    setMetaValue(db, "legacy_migrated_from", "captures_legacy");
    setMetaValue(db, "legacy_migrated_at", new Date().toISOString());
    setMetaValue(db, "backfill_chunk_indexes", String(chunkIndexesBackfilled));
    recordMigration(db, MIGRATION_LEGACY_TO_V4, {
      legacy_rows_migrated: migrated,
      chunk_indexes_backfilled: chunkIndexesBackfilled
    });
    db.run("COMMIT;");
    return migrated;
  } catch (error) {
    try {
      db.run("ROLLBACK;");
    } catch (_rollbackError) {
      // Ignore rollback errors and surface original migration failure.
    }
    throw error;
  }
}

export function ensureSchemaV2(db) {
  db.run("PRAGMA foreign_keys = ON;");
  createMetaTable(db);

  const hasLegacyNamedCaptures = isLegacyCapturesTable(db, "captures");
  const schemaVersion = getDbSchemaVersion(db);
  const hasLegacyArchive = isLegacyCapturesTable(db, "captures_legacy");

  if (hasLegacyNamedCaptures || (hasLegacyArchive && schemaVersion < SQLITE_DB_SCHEMA_VERSION)) {
    migrateLegacyToV2(db);
    return;
  }

  ensureCoreTablesV2(db);
  ensureSchemaColumnsV4(db);
  const hadFts = hasFtsTable(db);
  const hasFts = ensureFtsIfPossible(db);
  if (schemaVersion < SQLITE_DB_SCHEMA_VERSION) {
    db.run("BEGIN;");
    try {
      const backfillStats = backfillDerivedTablesFromExistingCaptures(db);
      const chunkIndexesBackfilled = backfillChunkIndexes(db);
      pruneOrphanGraphRows(db);
      setMetaValue(db, "backfill_annotations", String(backfillStats.annotationsBackfilled || 0));
      setMetaValue(
        db,
        "backfill_transcript_segments",
        String(backfillStats.transcriptSegmentsBackfilled || 0)
      );
      setMetaValue(db, "backfill_graph_rows", String(backfillStats.graphBackfilled || 0));
      setMetaValue(db, "backfill_chunk_indexes", String(chunkIndexesBackfilled));
      setMetaValue(db, "backfill_completed_at", new Date().toISOString());
      setMetaValue(db, "backfill_fts_rows", String(hasFts ? rebuildFtsFromChunks(db) : 0));
      setDbSchemaName(db, SQLITE_DB_SCHEMA_NAME);
      setDbSchemaVersion(db, SQLITE_DB_SCHEMA_VERSION);
      recordMigration(db, schemaVersion === 0 ? MIGRATION_BOOTSTRAP_V4 : MIGRATION_ADD_CHUNK_INDEX, {
        annotations_backfilled: backfillStats.annotationsBackfilled || 0,
        transcript_segments_backfilled: backfillStats.transcriptSegmentsBackfilled || 0,
        graph_rows_backfilled: backfillStats.graphBackfilled || 0,
        chunk_indexes_backfilled: chunkIndexesBackfilled
      });
      db.run("COMMIT;");
    } catch (error) {
      try {
        db.run("ROLLBACK;");
      } catch (_rollbackError) {
        // Ignore rollback errors and surface original backfill failure.
      }
      throw error;
    }
  } else if (hasFts && !hadFts) {
    // FTS may become available in a later runtime; backfill it when first created.
    rebuildFtsFromChunks(db);
  }

  if (!getMetaValue(db, "db_schema_name")) {
    setDbSchemaName(db, SQLITE_DB_SCHEMA_NAME);
  }
}

async function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) => chrome.runtime.getURL(`src/vendor/${file}`)
    });
  }

  return sqlJsPromise;
}

function openDatabase(SQL, buffer) {
  if (buffer && buffer.byteLength > 0) {
    return new SQL.Database(new Uint8Array(buffer));
  }

  return new SQL.Database();
}

export async function openSqliteFromDirectoryHandle(
  directoryHandle,
  dbFileName = DEFAULT_DB_NAME
) {
  const SQL = await getSqlJs();
  const fileHandle = await directoryHandle.getFileHandle(dbFileName, { create: true });
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  const db = openDatabase(SQL, buffer);
  ensureSchemaV2(db);

  return {
    SQL,
    db,
    fileHandle,
    dbFileName
  };
}

export async function saveRecordToSqlite(directoryHandle, record, dbFileName = DEFAULT_DB_NAME) {
  const { db, fileHandle } = await openSqliteFromDirectoryHandle(directoryHandle, dbFileName);

  try {
    saveRecordToDbV2(db, record, { ensureSchema: false, useTransaction: true });
    const binaryArray = db.export();
    const writable = await fileHandle.createWritable();
    let writeError = null;
    try {
      await writable.write(binaryArray);
    } catch (error) {
      writeError = error;
    } finally {
      try {
        await writable.close();
      } catch (closeError) {
        if (writeError) {
          throw buildWriteCloseError(dbFileName, writeError, closeError);
        }
        throw closeError;
      }
    }
    if (writeError) {
      throw writeError;
    }
    return dbFileName;
  } finally {
    db.close();
  }
}

function mapDocumentRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    metadata: decodeJson(row.metadata_json, null)
  };
}

function mapCaptureRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    document_text_compressed: decodeJson(row.document_text_compressed_json, null),
    transcript_segments: decodeJson(row.transcript_segments_json, null),
    diagnostics: decodeJson(row.diagnostics_json, null),
    legacy_record: decodeJson(row.legacy_record_json, null)
  };
}

function mapChunkRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row
  };
}

function mapEdgeRow(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    properties: decodeJson(row.properties_json, null)
  };
}

function escapeLikeQuery(text) {
  return String(text || "").replace(/[\\%_]/g, "\\$&");
}

export function getDocumentByUrl(db, url) {
  const normalized = normalizeNullableString(url);
  if (!normalized) {
    return null;
  }
  const row = runSelectOne(
    db,
    `SELECT * FROM documents WHERE url = ? OR canonical_url = ? LIMIT 1;`,
    [normalized, normalized]
  );
  return mapDocumentRow(row);
}

export function listRecentCaptures(db, limit = DEFAULT_LIST_LIMIT, offset = 0) {
  const normalizedLimit = Math.max(1, clampInteger(limit, DEFAULT_LIST_LIMIT));
  const normalizedOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER);
  const rows = runSelectAll(
    db,
    `
      SELECT
        c.*,
        d.url AS document_url,
        d.title AS document_title,
        d.site AS document_site
      FROM captures c
      INNER JOIN documents d ON d.document_id = c.document_id
      ORDER BY c.saved_at DESC
      LIMIT ? OFFSET ?;
    `,
    [normalizedLimit, normalizedOffset]
  );

  return rows.map(mapCaptureRow);
}

export function searchChunksByText(db, query, limit = DEFAULT_LIST_LIMIT) {
  const normalizedQuery = normalizeNullableString(query);
  if (!normalizedQuery) {
    return [];
  }
  const normalizedLimit = Math.max(1, clampInteger(limit, DEFAULT_LIST_LIMIT));

  if (hasFtsTable(db)) {
    try {
      const rows = runSelectAll(
        db,
        `
          SELECT
            c.*,
            d.url AS document_url,
            d.title AS document_title
          FROM chunks_fts f
          INNER JOIN chunks c ON c.chunk_id = f.chunk_id
          INNER JOIN documents d ON d.document_id = c.document_id
          WHERE chunks_fts MATCH ?
          ORDER BY
            bm25(chunks_fts),
            CASE WHEN c.chunk_index IS NULL THEN 1 ELSE 0 END ASC,
            c.chunk_index ASC,
            c.created_at DESC
          LIMIT ?;
        `,
        [normalizedQuery, normalizedLimit]
      );
      return rows.map(mapChunkRow);
    } catch (_error) {
      // Fall through to LIKE search when MATCH parsing fails for raw input.
    }
  }

  const pattern = `%${escapeLikeQuery(normalizedQuery)}%`;
  const rows = runSelectAll(
    db,
    `
      SELECT
        c.*,
        d.url AS document_url,
        d.title AS document_title
      FROM chunks c
      INNER JOIN documents d ON d.document_id = c.document_id
      WHERE c.text LIKE ? ESCAPE '\\'
        OR COALESCE(c.comment, '') LIKE ? ESCAPE '\\'
      ORDER BY
        c.created_at DESC,
        CASE WHEN c.chunk_index IS NULL THEN 1 ELSE 0 END ASC,
        c.chunk_index ASC
      LIMIT ?;
    `,
    [pattern, pattern, normalizedLimit]
  );
  return rows.map(mapChunkRow);
}

export function getDocumentContext(db, documentId) {
  const normalizedId = normalizeNullableString(documentId);
  if (!normalizedId) {
    return null;
  }

  const document = mapDocumentRow(
    runSelectOne(db, `SELECT * FROM documents WHERE document_id = ? LIMIT 1;`, [normalizedId])
  );
  if (!document) {
    return null;
  }

  const chunks = runSelectAll(
    db,
    `
      SELECT c.*
      FROM chunks c
      WHERE c.document_id = ?
      ORDER BY
        CASE WHEN c.chunk_index IS NULL THEN 1 ELSE 0 END ASC,
        c.chunk_index ASC,
        c.created_at ASC,
        c.chunk_id ASC;
    `,
    [normalizedId]
  ).map(mapChunkRow);

  const captures = runSelectAll(
    db,
    `
      SELECT *
      FROM captures
      WHERE document_id = ?
      ORDER BY saved_at DESC;
    `,
    [normalizedId]
  ).map(mapCaptureRow);

  const annotations = runSelectAll(
    db,
    `
      SELECT *
      FROM annotations
      WHERE document_id = ?
      ORDER BY created_at ASC, annotation_id ASC;
    `,
    [normalizedId]
  );

  const transcriptSegments = runSelectAll(
    db,
    `
      SELECT *
      FROM transcript_segments
      WHERE document_id = ?
      ORDER BY capture_id ASC, segment_index ASC;
    `,
    [normalizedId]
  );

  const edges = runSelectAll(
    db,
    `
      SELECT DISTINCT e.*
      FROM edges e
      INNER JOIN provenance p
        ON p.subject_type = 'edge' AND p.subject_id = e.edge_id
      INNER JOIN chunks c ON c.chunk_id = p.chunk_id
      WHERE c.document_id = ?
      ORDER BY e.created_at DESC;
    `,
    [normalizedId]
  ).map(mapEdgeRow);

  const entities = runSelectAll(
    db,
    `
      SELECT DISTINCT e.*
      FROM entities e
      INNER JOIN provenance p
        ON p.subject_type = 'entity' AND p.subject_id = e.entity_id
      INNER JOIN chunks c ON c.chunk_id = p.chunk_id
      WHERE c.document_id = ?
      ORDER BY e.created_at DESC;
    `,
    [normalizedId]
  ).map((row) => ({
    ...row,
    properties: decodeJson(row.properties_json, null)
  }));

  return {
    document,
    captures,
    chunks,
    annotations,
    transcriptSegments,
    entities,
    edges
  };
}
