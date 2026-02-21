# Improvements TODO

## 1. Add write serialization for capture saves
Description: Prevent concurrent save operations from causing race conditions, partial writes, or DB export contention.
Desired result: All capture writes are serialized through one queue, producing deterministic and corruption-safe storage behavior.
- [x] Define a save queue/mutex in the background worker.
- [x] Route all capture actions through the queue wrapper.
- [x] Add timeout and cancellation handling for stuck jobs.
- [x] Add tests that simulate rapid consecutive saves.
- [x] Add debug logging for queue depth and job duration.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `hardening: serialize capture writes`.

## 2. Restrict YouTube fetch proxy message handlers
Description: Reduce abuse risk by preventing runtime fetch proxy endpoints from requesting arbitrary external URLs.
Desired result: Only trusted YouTube-related HTTPS endpoints are allowed for background fetch proxy actions.
- [x] Validate `message.url` exists and parses as a URL.
- [x] Allow only `https` scheme.
- [x] Add host allowlist (`youtube.com`, `*.youtube.com`, `googlevideo.com`, `*.googlevideo.com`).
- [x] Reject disallowed URLs with clear error responses.
- [x] Add tests for accepted/rejected URL cases.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `security: restrict youtube fetch proxy`.

## 3. Add explicit schema migration registry in SQLite meta
Description: Improve migration traceability and safety by tracking named migration steps and execution metadata.
Desired result: Schema upgrades are auditable, idempotent, and recoverable across app versions.
- [x] Add meta keys for migration name/id/timestamp.
- [x] Define migration IDs in code.
- [x] Persist migration markers atomically.
- [x] Guard re-runs with idempotent checks.
- [x] Add migration regression tests.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `sqlite: add migration registry metadata`.

## 4. Add chunk_index for deterministic ordering
Description: Ensure chunk order is explicit and stable for export, replay, and downstream analytical processing.
Desired result: Chunks can always be returned in canonical per-capture order.
- [x] Add `chunk_index INTEGER` to `chunks` with migration.
- [x] Populate `chunk_index` during chunk generation.
- [x] Backfill old rows with deterministic ordering.
- [x] Add `(capture_id, chunk_index)` index.
- [x] Update query helpers to use `chunk_index` ordering.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `sqlite: add chunk index ordering`.

## 5. Normalize URLs before document upsert
Description: Avoid duplicate documents caused by URL variants and tracking parameters.
Desired result: Equivalent URLs map to one canonical document record.
- [x] Add URL normalization helper.
- [x] Normalize before document upsert and lookup.
- [x] Preserve original URL in metadata for audit.
- [x] Handle collisions safely.
- [x] Add tests for normalized URL equivalence.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `sqlite: normalize document urls`.

## 6. Improve document lookup/index strategy
Description: Speed up document resolution and improve query performance for URL-based lookups.
Desired result: Fast, predictable lookups for `url`, `canonical_url`, and normalized variants.
- [ ] Add index on `documents.canonical_url`.
- [ ] Consider adding `normalized_url` column + index.
- [ ] Backfill normalized URL values for existing rows.
- [ ] Update lookup helpers to use normalized-first logic.
- [ ] Validate query plans and benchmark with sample data.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `sqlite: optimize document lookup indexes`.
- [x] Add index on `documents.canonical_url`.
- [x] Consider adding `normalized_url` column + index.
- [x] Backfill normalized URL values for existing rows.
- [x] Update lookup helpers to use normalized-first logic.
- [x] Validate query plans and benchmark with sample data.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `sqlite: optimize document lookup indexes`.

## 7. Add DB maintenance routines
Description: Keep long-lived SQLite files performant and healthy as data volume grows.
Desired result: Periodic maintenance improves query speed and prevents file bloat.
- [ ] Add maintenance helper for `ANALYZE` and optional `VACUUM`.
- [ ] Add maintenance metadata fields in `meta`.
- [ ] Trigger lightweight maintenance during safe upgrade points.
- [ ] Add guardrails to avoid running on every write.
- [ ] Document maintenance behavior.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `sqlite: add maintenance routine`.
- [x] Add maintenance helper for `ANALYZE` and optional `VACUUM`.
- [x] Add maintenance metadata fields in `meta`.
- [x] Trigger lightweight maintenance during safe upgrade points.
- [x] Add guardrails to avoid running on every write.
- [x] Document maintenance behavior.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `sqlite: add maintenance routine`.

## 8. Add retry policy for file writes
Description: Improve resilience to transient file system write errors.
Desired result: Temporary write failures are retried safely before surfacing errors to users.
- [ ] Add bounded retry logic for JSON writes.
- [ ] Add bounded retry logic for SQLite writes.
- [ ] Keep write/close error composition clear.
- [ ] Retry only retryable errors.
- [ ] Add tests for transient failure scenarios.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `storage: add bounded write retries`.
- [x] Add bounded retry logic for JSON writes.
- [x] Add bounded retry logic for SQLite writes.
- [x] Keep write/close error composition clear.
- [x] Retry only retryable errors.
- [x] Add tests for transient failure scenarios.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `storage: add bounded write retries`.

## 9. Add input size guards for annotations/comments
Description: Prevent oversized payloads from degrading performance or creating pathological records.
Desired result: Annotation and comment fields are bounded, validated, and consistently handled.
- [ ] Define max length limits for annotation-related fields.
- [ ] Enforce truncation or rejection policy.
- [ ] Record truncation info in diagnostics when enabled.
- [ ] Apply same rules for JSON and SQLite paths.
- [ ] Add tests for large payload inputs.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `validation: enforce annotation size limits`.

## 10. Refactor oversized modules
Description: Reduce complexity by splitting large files into focused modules with clearer boundaries.
Desired result: Smaller modules with cleaner ownership and easier testing/maintenance.
- [ ] Split `background.js` into focused modules.
- [ ] Split `content.js` into extraction/UI/transcript modules.
- [ ] Split `sqlite.js` into schema/migration/write/query modules.
- [ ] Keep public APIs stable during refactor.
- [ ] Add regression tests for refactored paths.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `refactor: split large runtime modules`.

## 11. Deduplicate shared helpers
Description: Remove duplicated logic across background/content/options/popup to reduce drift and bugs.
Desired result: Shared helper functions are centralized and reused consistently.
- [ ] Extract shared URL helpers into common module.
- [ ] Extract shared folder/path formatting helpers.
- [ ] Extract shared bubble settings normalization.
- [ ] Replace duplicated local implementations.
- [ ] Add unit tests for shared helpers.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `refactor: centralize shared helpers`.

## 12. Harden Firefox-specific fallbacks
Description: Ensure behavior is robust when Chrome-specific APIs are unavailable in Firefox.
Desired result: Firefox path is fully usable with explicit fallbacks and clear UX messaging.
- [ ] Audit all `chrome.offscreen` dependent flows.
- [ ] Implement fallback logic for PDF and clipboard paths.
- [ ] Add capability detection + user-visible guidance.
- [ ] Add Firefox manual/automated verification checklist.
- [ ] Update README for browser differences.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `firefox: harden api fallback paths`.

## 13. Add highlight rendering fallback when CSS Highlights is missing
Description: Preserve queued highlight visibility where CSS Highlights API is not supported.
Desired result: Pending highlight/note visualization works reliably across browsers.
- [ ] Implement DOM wrapper fallback renderer.
- [ ] Style highlight vs note states distinctly.
- [ ] Ensure delete/clear restores DOM cleanly.
- [ ] Add performance guardrails for large pages.
- [ ] Add browser compatibility test cases.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `content: add highlight fallback renderer`.

## 14. Strengthen runtime message validation
Description: Prevent malformed messages from triggering undefined behavior in service worker/content script.
Desired result: Every runtime message is schema-validated with consistent error handling.
- [ ] Define schema/type checks for all message types.
- [ ] Validate payloads before action dispatch.
- [ ] Return consistent structured error payloads.
- [ ] Add tests for malformed and unknown messages.
- [ ] Remove implicit assumptions in handlers.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `hardening: validate runtime message payloads`.

## 15. Increase type safety and stricter checks
Description: Catch integration and nullability issues earlier with stronger static checking.
Desired result: Stricter `checkJs` setup with documented type contracts across major modules.
- [ ] Increase strictness flags incrementally.
- [ ] Add JSDoc typedefs for records/messages/results.
- [ ] Resolve or explicitly suppress remaining strict errors.
- [ ] Gate stricter checks in CI.
- [ ] Track remaining typing debt.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `types: tighten checkjs contracts`.

## 16. Extend syntax checks to all runtime modules
Description: Ensure all shipped source modules are included in static syntax checks.
Desired result: `npm run check` covers the complete runtime code surface.
- [ ] Update `check` script to include all non-vendor runtime files.
- [ ] Keep vendor bundles excluded.
- [ ] Add CI assertion for check coverage.
- [ ] Fail fast on stale script paths.
- [ ] Update contributor docs with check expectations.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `ci: expand syntax check coverage`.

## 17. Expand test coverage for orchestration paths
Description: Cover high-risk runtime orchestration flows that are currently under-tested.
Desired result: Save orchestration, note queueing, and message workflows have regression coverage.
- [ ] Add tests for JSON/SQLite/both save combinations.
- [ ] Add tests for pending annotation lifecycle.
- [ ] Add tests for background/content message handlers.
- [ ] Add tests for PDF fallback selection path.
- [ ] Add tests for notes panel sync/delete behavior.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `test: add orchestration path coverage`.

## 18. Add build/manifest validation tests
Description: Ensure release artifacts are correct for both Chrome and Firefox builds.
Desired result: Build pipeline fails early on manifest/output packaging mistakes.
- [ ] Add script to validate built manifests per target.
- [ ] Assert required/forbidden permissions per target.
- [ ] Validate zip names and output structure.
- [ ] Add validation step in CI/release workflows.
- [ ] Improve error output for failed validation.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `build: validate browser artifact manifests`.

## 19. Add i18n scaffolding
Description: Prepare UI text system for localization and cleaner message management.
Desired result: User-facing strings are centralized and localizable without code edits.
- [ ] Create locale resource structure.
- [ ] Replace hardcoded UI strings with lookup keys.
- [ ] Add at least one secondary locale for validation.
- [ ] Implement fallback for missing translation keys.
- [ ] Document i18n contribution flow.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `i18n: scaffold localized ui strings`.

## 20. Add structured debug logging controls
Description: Improve observability while controlling noise and sensitive output.
Desired result: Consistent log utility with configurable levels and safe message redaction.
- [ ] Add log level setting (`off`, `error`, `info`, `debug`).
- [ ] Replace scattered `console.*` with logger utility.
- [ ] Redact sensitive text by default.
- [ ] Add run correlation IDs and module tags.
- [ ] Add tests for log gating behavior.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `observability: add structured logger controls`.
