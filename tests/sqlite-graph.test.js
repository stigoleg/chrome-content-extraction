import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import initSqlJs from "sql.js";
import { SaveOperationQueue } from "../src/save-queue.js";

import {
  buildJsonChunksForRecord,
  SQLITE_DB_SCHEMA_NAME,
  SQLITE_DB_SCHEMA_VERSION,
  ensureSchemaV2,
  getDbSchemaVersion,
  getDocumentByUrl,
  getDocumentContext,
  migrateLegacyToV2,
  saveRecordToDbV2,
  searchChunksByText
} from "../src/sqlite.js";

const SQL = await initSqlJs({
  locateFile: (file) => path.join(process.cwd(), "node_modules/sql.js/dist", file)
});

function queryRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function scalar(db, sql, params = []) {
  const row = queryRows(db, sql, params)[0];
  if (!row) {
    return null;
  }
  const keys = Object.keys(row);
  if (!keys.length) {
    return null;
  }
  return row[keys[0]];
}

function createLegacyCapturesTable(db) {
  db.run(`
    CREATE TABLE captures (
      id TEXT PRIMARY KEY,
      schemaVersion TEXT,
      captureType TEXT,
      savedAt TEXT,
      sourceUrl TEXT,
      sourceTitle TEXT,
      sourceSite TEXT,
      sourceLanguage TEXT,
      sourcePublishedAt TEXT,
      sourceMetadata TEXT,
      selectedText TEXT,
      documentText TEXT,
      documentTextWordCount INTEGER,
      documentTextCharacterCount INTEGER,
      contentHash TEXT,
      documentTextCompressed TEXT,
      comment TEXT,
      annotations TEXT,
      transcriptText TEXT,
      transcriptSegments TEXT,
      diagnostics TEXT
    );
  `);
  db.run(`CREATE INDEX captures_savedAt ON captures(savedAt);`);
  db.run(`CREATE INDEX captures_type ON captures(captureType);`);
}

test("ensureSchemaV2 creates latest graph-ready tables on a new database", () => {
  const db = new SQL.Database();
  try {
    ensureSchemaV2(db);

    const tableNames = new Set(
      queryRows(db, `SELECT name FROM sqlite_master WHERE type = 'table';`).map((row) => row.name)
    );

    assert.equal(getDbSchemaVersion(db), SQLITE_DB_SCHEMA_VERSION);
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'db_schema_version';`),
      String(SQLITE_DB_SCHEMA_VERSION)
    );
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'db_schema_name';`),
      SQLITE_DB_SCHEMA_NAME
    );
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_id';`) !== null,
      true
    );
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'migration_history_json';`) !== null,
      true
    );

    for (const table of [
      "meta",
      "documents",
      "captures",
      "chunks",
      "annotations",
      "transcript_segments",
      "entities",
      "entity_aliases",
      "edges",
      "provenance"
    ]) {
      assert.equal(tableNames.has(table), true, `Expected table ${table} to exist`);
    }

    const chunkColumns = new Set(queryRows(db, `PRAGMA table_info(chunks);`).map((row) => row.name));
    assert.equal(chunkColumns.has("chunk_index"), true);
  } finally {
    db.close();
  }
});

test("migrateLegacyToV2 migrates legacy captures rows into documents/captures/chunks", () => {
  const db = new SQL.Database();
  try {
    createLegacyCapturesTable(db);

    const legacyAnnotations = JSON.stringify([
      {
        selectedText: "important sentence",
        comment: "from legacy annotations",
        createdAt: "2026-02-20T10:01:00.000Z"
      }
    ]);

    db.run(
      `
        INSERT INTO captures (
          id,
          schemaVersion,
          captureType,
          savedAt,
          sourceUrl,
          sourceTitle,
          sourceSite,
          sourceLanguage,
          sourcePublishedAt,
          sourceMetadata,
          selectedText,
          documentText,
          documentTextWordCount,
          documentTextCharacterCount,
          contentHash,
          documentTextCompressed,
          comment,
          annotations,
          transcriptText,
          transcriptSegments,
          diagnostics
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        "legacy-capture-1",
        "1.3.0",
        "selected_text",
        "2026-02-20T10:00:00.000Z",
        "https://example.com/legacy",
        "Legacy Title",
        "example.com",
        "en",
        "2026-02-10T00:00:00.000Z",
        JSON.stringify({ canonicalUrl: "https://example.com/legacy" }),
        "important sentence",
        "This is an important sentence in a legacy capture.",
        9,
        47,
        "legacy-hash-1",
        null,
        "legacy inline note",
        legacyAnnotations,
        null,
        null,
        JSON.stringify({ migratedFrom: "test" })
      ]
    );

    const migrated = migrateLegacyToV2(db);
    assert.equal(migrated, 1);
    assert.equal(getDbSchemaVersion(db), SQLITE_DB_SCHEMA_VERSION);
    assert.equal(
      scalar(
        db,
        `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'captures_legacy';`
      ),
      1
    );

    assert.equal(scalar(db, `SELECT COUNT(*) FROM documents;`), 1);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM captures;`), 1);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks;`) >= 1, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks WHERE chunk_index IS NULL;`), 0);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM annotations;`) >= 1, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM entities;`) >= 2, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM edges;`) >= 1, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM provenance;`) >= 1, true);
    assert.equal(scalar(db, `SELECT url FROM documents LIMIT 1;`), "https://example.com/legacy");
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'db_schema_name';`),
      SQLITE_DB_SCHEMA_NAME
    );
    assert.equal(
      scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_id';`),
      "legacy_captures_to_v4"
    );

    const chunkTypes = new Set(queryRows(db, `SELECT chunk_type FROM chunks;`).map((row) => row.chunk_type));
    assert.equal(chunkTypes.has("document"), true);
  } finally {
    db.close();
  }
});

test("saveRecordToDbV2 writes document, capture, chunks, and graph rows", () => {
  const db = new SQL.Database();
  try {
    const documentText =
      "This is the first highlight sentence in the article. Here is the second highlight too.";
    const record = {
      id: "capture-v2-1",
      schemaVersion: "1.4.0",
      captureType: "selected_text",
      savedAt: "2026-02-21T12:00:00.000Z",
      source: {
        url: "https://example.com/article-1",
        title: "Article 1",
        site: "example.com",
        language: "en",
        publishedAt: "2026-02-10T00:00:00.000Z",
        metadata: {
          canonicalUrl: "https://example.com/article-1"
        }
      },
      content: {
        documentText,
        documentTextWordCount: 15,
        documentTextCharacterCount: documentText.length,
        contentHash: "hash-v2-1",
        documentTextCompressed: null,
        annotations: [
          {
            selectedText: "first highlight sentence",
            comment: null,
            createdAt: "2026-02-21T12:00:01.000Z"
          },
          {
            selectedText: "second highlight",
            comment: "note on second highlight",
            createdAt: "2026-02-21T12:00:02.000Z"
          }
        ],
        transcriptText: "line one\nline two",
        transcriptSegments: [
          {
            timestamp: "00:00",
            text: "line one"
          },
          {
            timestamp: "00:02",
            text: "line two"
          }
        ]
      },
      diagnostics: {
        extractorVersion: "1",
        source: "test"
      }
    };

    const result = saveRecordToDbV2(db, record);
    assert.equal(result.captureId, "capture-v2-1");

    assert.equal(scalar(db, `SELECT COUNT(*) FROM documents;`), 1);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM captures;`), 1);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks;`), 5);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM annotations;`), 2);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM transcript_segments;`), 2);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks WHERE chunk_index IS NULL;`), 0);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM entities;`) >= 3, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM edges;`) >= 2, true);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM provenance;`) >= 2, true);
    assert.equal(
      scalar(db, `SELECT legacy_record_json FROM captures WHERE capture_id = 'capture-v2-1';`),
      null
    );

    const typeCounts = queryRows(
      db,
      `
        SELECT chunk_type, COUNT(*) AS count
        FROM chunks
        GROUP BY chunk_type;
      `
    );
    const countsByType = Object.fromEntries(typeCounts.map((row) => [row.chunk_type, row.count]));
    assert.equal(countsByType.document >= 1, true);
    assert.equal(countsByType.highlight, 1);
    assert.equal(countsByType.note, 1);
    assert.equal(countsByType.transcript_segment, 2);
    assert.equal(
      scalar(db, `SELECT COUNT(*) FROM chunks WHERE capture_id = 'capture-v2-1' AND chunk_index IS NULL;`),
      0
    );
    const chunkIndexes = queryRows(
      db,
      `
        SELECT chunk_index
        FROM chunks
        WHERE capture_id = 'capture-v2-1'
        ORDER BY chunk_index ASC;
      `
    ).map((row) => Number(row.chunk_index));
    assert.deepEqual(chunkIndexes, [0, 1, 2, 3, 4]);

    const captureRow = queryRows(
      db,
      `
        SELECT c.capture_id, c.capture_type, d.url AS document_url
        FROM captures c
        INNER JOIN documents d ON d.document_id = c.document_id
        WHERE c.capture_id = ?;
      `,
      ["capture-v2-1"]
    )[0];
    assert.equal(captureRow.capture_id, "capture-v2-1");
    assert.equal(captureRow.capture_type, "selected_text");
    assert.equal(captureRow.document_url, "https://example.com/article-1");

    const highlightRow = queryRows(
      db,
      `
        SELECT start_offset, end_offset
        FROM chunks
        WHERE capture_id = ? AND chunk_type = 'highlight'
        LIMIT 1;
      `,
      ["capture-v2-1"]
    )[0];
    assert.equal(typeof highlightRow.start_offset, "number");
    assert.equal(typeof highlightRow.end_offset, "number");
    assert.equal(highlightRow.end_offset > highlightRow.start_offset, true);
  } finally {
    db.close();
  }
});

test("searchChunksByText and getDocumentContext resolve full document text and graph context", () => {
  const db = new SQL.Database();
  try {
    const longTail = "tail phrase for retrieval context";
    const record = {
      id: "capture-v2-query-1",
      captureType: "selected_text",
      savedAt: "2026-02-21T13:00:00.000Z",
      source: {
        url: "https://example.com/query-article",
        title: "Query Article",
        site: "example.com",
        language: "en",
        metadata: {}
      },
      content: {
        documentText: `${"intro ".repeat(500)} ${longTail}`,
        documentTextWordCount: 503,
        documentTextCharacterCount: 0,
        contentHash: "hash-query-1",
        annotations: [
          {
            selectedText: "intro intro",
            comment: "seed note",
            createdAt: "2026-02-21T13:00:01.000Z"
          }
        ],
        transcriptSegments: null
      }
    };

    const result = saveRecordToDbV2(db, record);
    const hits = searchChunksByText(db, longTail, 10);
    assert.equal(hits.length >= 1, true);
    assert.equal(hits.some((row) => String(row.text || "").includes(longTail)), true);

    const context = getDocumentContext(db, result.documentId);
    assert.equal(Boolean(context), true);
    assert.equal(context.captures.length >= 1, true);
    assert.equal(context.annotations.length, 1);
    assert.equal(context.entities.length >= 2, true);
    assert.equal(context.edges.length >= 1, true);
  } finally {
    db.close();
  }
});

test("saving same capture id updates rows without graph duplication", () => {
  const db = new SQL.Database();
  try {
    const baseRecord = {
      id: "capture-upsert-1",
      captureType: "selected_text",
      savedAt: "2026-02-21T14:00:00.000Z",
      source: {
        url: "https://example.com/upsert",
        title: "Upsert Article",
        site: "example.com",
        language: "en",
        metadata: {}
      },
      content: {
        documentText: "Alpha beta gamma delta epsilon zeta.",
        contentHash: "hash-upsert-1",
        annotations: [
          {
            selectedText: "Alpha beta",
            comment: null,
            createdAt: "2026-02-21T14:00:01.000Z"
          }
        ],
        transcriptSegments: null
      }
    };

    saveRecordToDbV2(db, baseRecord);

    const updatedRecord = {
      ...baseRecord,
      savedAt: "2026-02-21T14:05:00.000Z",
      content: {
        ...baseRecord.content,
        annotations: [
          {
            selectedText: "Alpha beta",
            comment: "first note",
            createdAt: "2026-02-21T14:05:01.000Z"
          },
          {
            selectedText: "gamma delta",
            comment: null,
            createdAt: "2026-02-21T14:05:02.000Z"
          }
        ]
      }
    };

    saveRecordToDbV2(db, updatedRecord);

    assert.equal(scalar(db, `SELECT COUNT(*) FROM captures WHERE capture_id = 'capture-upsert-1';`), 1);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM annotations WHERE capture_id = 'capture-upsert-1';`), 2);

    const captureEntityId = "entity:capture:capture-upsert-1";
    assert.equal(
      scalar(
        db,
        `
          SELECT COUNT(*)
          FROM edges
          WHERE from_entity_id = ? AND predicate = 'captured_annotation';
        `,
        [captureEntityId]
      ),
      2
    );

    assert.equal(
      scalar(
        db,
        `
          SELECT COUNT(*)
          FROM provenance
          WHERE subject_type = 'edge'
            AND subject_id LIKE 'edge:capture_annotation:capture-upsert-1:%';
        `
      ),
      2
    );
  } finally {
    db.close();
  }
});

test("getDocumentByUrl resolves canonical_url and comment-only notes remain searchable", () => {
  const db = new SQL.Database();
  try {
    const record = {
      id: "capture-canonical-1",
      captureType: "selected_text",
      savedAt: "2026-02-21T15:00:00.000Z",
      source: {
        url: "https://example.com/article?utm_source=test",
        title: "Canonical Article",
        site: "example.com",
        language: "en",
        metadata: {
          canonicalUrl: "https://example.com/article"
        }
      },
      content: {
        documentText: "A canonical body for lookup and note capture.",
        contentHash: "hash-canonical-1",
        annotations: [
          {
            selectedText: "",
            comment: "orphan note without selection",
            createdAt: "2026-02-21T15:00:01.000Z"
          }
        ],
        transcriptSegments: null
      }
    };

    saveRecordToDbV2(db, record);

    const canonicalDoc = getDocumentByUrl(db, "https://example.com/article");
    assert.equal(canonicalDoc?.url, "https://example.com/article?utm_source=test");

    const noteRow = queryRows(
      db,
      `
        SELECT text, comment
        FROM chunks
        WHERE capture_id = 'capture-canonical-1' AND chunk_type = 'note'
        LIMIT 1;
      `
    )[0];
    assert.equal(noteRow.text, "orphan note without selection");
    assert.equal(noteRow.comment, "orphan note without selection");

    const hits = searchChunksByText(db, "orphan note", 5);
    assert.equal(hits.length >= 1, true);
  } finally {
    db.close();
  }
});

test("ensureSchemaV2 rebuilds FTS rows when FTS table is recreated later", () => {
  const db = new SQL.Database();
  try {
    const record = {
      id: "capture-fts-1",
      captureType: "selected_text",
      savedAt: "2026-02-21T16:00:00.000Z",
      source: {
        url: "https://example.com/fts",
        title: "FTS Article",
        site: "example.com",
        language: "en",
        metadata: {}
      },
      content: {
        documentText: "fts seed text for rebuild validation",
        contentHash: "hash-fts-1",
        annotations: [],
        transcriptSegments: null
      }
    };

    saveRecordToDbV2(db, record);
    const hasInitialFts = scalar(
      db,
      `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts';`
    );
    if (!hasInitialFts) {
      return;
    }

    db.run(`DROP TABLE chunks_fts;`);
    ensureSchemaV2(db);

    assert.equal(
      scalar(db, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts';`),
      1
    );
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks_fts;`) >= 1, true);
  } finally {
    db.close();
  }
});

test("buildJsonChunksForRecord returns document, note/highlight, and transcript chunks", () => {
  const record = {
    id: "capture-json-chunks-1",
    captureType: "selected_text",
    savedAt: "2026-02-21T17:00:00.000Z",
    source: {
      url: "https://example.com/json-chunks",
      title: "JSON Chunks",
      site: "example.com",
      language: "en",
      metadata: {}
    },
    content: {
      documentText: "Alpha beta gamma. Delta epsilon zeta.",
      annotations: [
        {
          selectedText: "Alpha beta",
          comment: null,
          createdAt: "2026-02-21T17:00:01.000Z"
        },
        {
          selectedText: "",
          comment: "note-only item",
          createdAt: "2026-02-21T17:00:02.000Z"
        }
      ],
      transcriptSegments: [
        {
          timestamp: "00:00",
          text: "segment one"
        }
      ]
    }
  };

  const chunks = buildJsonChunksForRecord(record);
  assert.equal(Array.isArray(chunks), true);
  assert.equal(chunks.some((chunk) => chunk.chunkType === "document"), true);
  assert.equal(chunks.some((chunk) => chunk.chunkType === "highlight"), true);
  assert.equal(chunks.some((chunk) => chunk.chunkType === "note"), true);
  assert.equal(chunks.some((chunk) => chunk.chunkType === "transcript_segment"), true);
  assert.equal(chunks.every((chunk) => Number.isInteger(chunk.chunkIndex)), true);
  assert.equal(
    chunks.some(
      (chunk) => chunk.chunkType === "note" && chunk.text === "note-only item" && chunk.comment === "note-only item"
    ),
    true
  );
});

test("SaveOperationQueue serializes rapid sqlite saves without corruption", async () => {
  const db = new SQL.Database();
  try {
    ensureSchemaV2(db);
    const queue = new SaveOperationQueue({ defaultTimeoutMs: 5000 });

    const makeRecord = (index) => {
      const text = `Document ${index} text with stable payload for queue integrity checks.`;
      return {
        id: `queue-capture-${index}`,
        schemaVersion: "1.4.0",
        captureType: "selected_text",
        savedAt: `2026-02-21T18:${String(index).padStart(2, "0")}:00.000Z`,
        source: {
          url: `https://example.com/queue/${index}`,
          title: `Queue ${index}`,
          site: "example.com",
          language: "en",
          metadata: {}
        },
        content: {
          documentText: text,
          documentTextWordCount: text.split(/\s+/).length,
          documentTextCharacterCount: text.length,
          contentHash: `queue-hash-${index}`,
          annotations: [
            {
              selectedText: "queue integrity",
              comment: index % 2 === 0 ? null : `note-${index}`,
              createdAt: `2026-02-21T18:${String(index).padStart(2, "0")}:30.000Z`
            }
          ],
          transcriptText: null,
          transcriptSegments: null
        },
        diagnostics: null
      };
    };

    const rapidWrites = Array.from({ length: 12 }, (_, index) =>
      queue.enqueue({
        label: `sqlite-rapid-${index}`,
        task: async () => saveRecordToDbV2(db, makeRecord(index), { ensureSchema: false, useTransaction: true })
      })
    );

    await Promise.all(rapidWrites);

    assert.equal(scalar(db, `SELECT COUNT(*) FROM captures;`), 12);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM documents;`), 12);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks WHERE chunk_type = 'document';`), 12);
    assert.equal(scalar(db, `SELECT COUNT(*) FROM chunks WHERE chunk_type IN ('highlight', 'note');`), 12);
    assert.equal(
      scalar(db, `SELECT COUNT(DISTINCT capture_id) FROM captures;`),
      scalar(db, `SELECT COUNT(*) FROM captures;`)
    );
  } finally {
    db.close();
  }
});

test("ensureSchemaV2 keeps migration metadata stable on reopen when no migration is needed", () => {
  const db = new SQL.Database();
  try {
    ensureSchemaV2(db);
    const beforeMigrationId = scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_id';`);
    const beforeMigrationAt = scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_at';`);
    const beforeHistory = scalar(db, `SELECT value FROM meta WHERE key = 'migration_history_json';`);

    ensureSchemaV2(db);

    const afterMigrationId = scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_id';`);
    const afterMigrationAt = scalar(db, `SELECT value FROM meta WHERE key = 'last_migration_at';`);
    const afterHistory = scalar(db, `SELECT value FROM meta WHERE key = 'migration_history_json';`);

    assert.equal(afterMigrationId, beforeMigrationId);
    assert.equal(afterMigrationAt, beforeMigrationAt);
    assert.equal(afterHistory, beforeHistory);
  } finally {
    db.close();
  }
});
