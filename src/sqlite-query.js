const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const TRACKING_QUERY_PARAM_PREFIXES = ["utm_"];
const TRACKING_QUERY_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "spm",
  "si"
]);

function shouldStripTrackingParam(rawKey) {
  const key = String(rawKey || "").toLowerCase().trim();
  if (!key) {
    return false;
  }
  if (TRACKING_QUERY_PARAM_NAMES.has(key)) {
    return true;
  }
  return TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeUrlForStorage(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (_error) {
    return normalized;
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  const isWebUrl = protocol === "http:" || protocol === "https:";
  if (!isWebUrl) {
    return parsed.toString();
  }

  parsed.hash = "";

  const keptEntries = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (shouldStripTrackingParam(key)) {
      continue;
    }
    keptEntries.push([key, value]);
  }
  keptEntries.sort((left, right) => {
    if (left[0] !== right[0]) {
      return left[0].localeCompare(right[0]);
    }
    return left[1].localeCompare(right[1]);
  });

  parsed.search = "";
  for (const [key, value] of keptEntries) {
    parsed.searchParams.append(key, value);
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/g, "") || "/";
  }

  return parsed.toString();
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

function tableExists(db, name) {
  const row = runSelectOne(
    db,
    `SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ? LIMIT 1;`,
    [name]
  );
  return Boolean(row?.name);
}

export function hasChunkFtsIndex(db) {
  return tableExists(db, "chunks_fts");
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
  const normalized = normalizeUrlForStorage(url) || normalizeNullableString(url);
  if (!normalized) {
    return null;
  }
  const row = runSelectOne(
    db,
    `
      SELECT *
      FROM documents
      WHERE normalized_url = ? OR url = ? OR canonical_url = ?
      ORDER BY
        CASE
          WHEN normalized_url = ? THEN 0
          WHEN url = ? THEN 1
          ELSE 2
        END ASC,
        created_at ASC,
        document_id ASC
      LIMIT 1;
    `,
    [normalized, normalized, normalized, normalized, normalized]
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

  if (hasChunkFtsIndex(db)) {
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
