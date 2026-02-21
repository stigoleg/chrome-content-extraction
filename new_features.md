# New Features TODO

## 1. Capture Library UI
Description: Provide an in-extension place to browse and inspect previously captured content.
Desired result: Users can efficiently navigate captures with clear list/detail workflows.
- [x] Add a dedicated capture library page in extension UI.
- [x] Implement paginated/sortable capture list.
- [x] Add filters by type, site, and date.
- [x] Add capture detail view with metadata and content.
- [x] Add loading/empty/error states.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `feature: add capture library ui`.

## 2. In-app chunk search
Description: Let users search captured chunks directly within the extension.
Desired result: Fast chunk search with FTS-first strategy and graceful fallback.
- [x] Add search input and debounced query execution.
- [x] Use SQLite FTS query path when available.
- [x] Fallback to LIKE query path when FTS is unavailable.
- [x] Highlight matched terms in result preview.
- [x] Add tests for both search modes.
- [x] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [x] Commit with a short message, e.g. `feature: add chunk search ui`.

## 3. Document context view
Description: Expose full context for a document (captures, chunks, graph links) in one screen.
Desired result: Users can inspect complete provenance-aware context for any document.
- [ ] Add document context route/view.
- [ ] Show grouped chunks by type.
- [ ] Show associated captures and timestamps.
- [ ] Show related entities/edges when available.
- [ ] Add copy/export actions from context view.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add document context page`.

## 4. Post-save editing
Description: Allow users to correct metadata and notes after capture.
Desired result: Safe post-save edits without breaking schema integrity or provenance links.
- [ ] Add edit UI for title/highlights/notes.
- [ ] Implement synchronized update path for JSON and SQLite outputs.
- [ ] Add edit metadata (`edited_at`, optional editor version).
- [ ] Add conflict handling for stale edits.
- [ ] Add tests for edit + rollback scenarios.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add post-save editing`.

## 5. Tags and collections
Description: Add user-defined organization primitives beyond date/type folders.
Desired result: Captures can be grouped and filtered by tags and collections.
- [ ] Add schema/tables for tags and collection mapping.
- [ ] Add UI for create/edit/delete tags and collections.
- [ ] Add assign/remove interactions in capture views.
- [ ] Add filter support in library/search screens.
- [ ] Add tests for tag integrity and CRUD flows.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add tags and collections`.

## 6. Duplicate detection and merge suggestions
Description: Detect repeated captures and reduce redundant data through merge guidance.
Desired result: Users are warned about duplicates and can merge safely.
- [ ] Add duplicate scoring based on URL/hash/content overlap.
- [ ] Surface duplicate alerts in save flow.
- [ ] Add merge options for annotations/metadata.
- [ ] Preserve provenance on merged entities.
- [ ] Add tests for duplicate and merge edge cases.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add duplicate detection and merge`.

## 7. Saved filter presets
Description: Let users save frequently used search/filter configurations.
Desired result: One-click reuse of common query scopes.
- [ ] Add preset CRUD UI.
- [ ] Persist preset definitions in local settings.
- [ ] Support default startup preset.
- [ ] Add reorder and quick-apply interactions.
- [ ] Add tests for preset persistence.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add saved filter presets`.

## 8. Export assistants
Description: Simplify structured data export for external analytics and AI workflows.
Desired result: Users can export scoped datasets in multiple machine-friendly formats.
- [ ] Add export wizard UI.
- [ ] Support JSON, NDJSON, CSV, and Markdown bundles.
- [ ] Add export filters by date/site/type/tag.
- [ ] Include optional graph/provenance files.
- [ ] Add format validation tests.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add export assistant`.

## 9. JSON-to-SQLite import/backfill
Description: Allow existing JSON archives to be imported into SQLite for advanced querying.
Desired result: Users can migrate historical JSON captures into graph-ready SQLite without data loss.
- [ ] Add importer for JSON capture files.
- [ ] Validate and report invalid/skipped records.
- [ ] Upsert into document/capture/chunk/graph tables.
- [ ] Add duplicate protection during import.
- [ ] Add tests with mixed valid/invalid datasets.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add json to sqlite importer`.

## 10. Graph explorer UI
Description: Provide a visual and navigable view of entities and relations.
Desired result: Users can inspect graph structure and relation evidence directly in-app.
- [ ] Add graph browser page.
- [ ] Add filters by entity type and predicate.
- [ ] Add edge detail with provenance links.
- [ ] Add basic graph metrics panel.
- [ ] Add performance handling for large graphs.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add graph explorer ui`.

## 11. Non-LLM entity extraction pipeline (phase 1)
Description: Populate graph tables with deterministic extraction before optional LLM enrichment.
Desired result: Baseline entity/edge coverage exists with reproducible, explainable heuristics.
- [ ] Define deterministic extraction rules for known types.
- [ ] Add basic noun/entity heuristics for page content.
- [ ] Add confidence scoring model.
- [ ] Persist entities/edges with provenance links.
- [ ] Add evaluation tests on fixture corpus.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add deterministic entity extraction`.

## 12. Provenance inspector UX
Description: Make evidence chains visible and accessible for trust and debugging.
Desired result: Any entity/edge can be traced to source chunk evidence quickly.
- [ ] Add provenance panel in context/graph views.
- [ ] Show linked chunk text and metadata.
- [ ] Add jump-to-chunk behavior.
- [ ] Add copy citation action.
- [ ] Add provenance retrieval tests.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add provenance inspector`.


## 14. Per-site storage profile
Description: Support domain-specific storage preferences and capture behavior.
Desired result: Effective settings can vary by site while preserving global defaults.
- [ ] Add per-site profile schema in settings.
- [ ] Add profile management UI.
- [ ] Resolve and apply profile at capture time.
- [ ] Show active profile indicator in capture UX.
- [ ] Add tests for settings resolution behavior.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add per-site storage profiles`.


## 17. PDF page-aware chunking
Description: Preserve page-level provenance for PDF-derived chunks and annotations.
Desired result: PDF chunks include page metadata and support page-scoped retrieval/export.
- [ ] Add page fields to PDF chunk records.
- [ ] Add page range capture option.
- [ ] Link annotations to page-aware offsets where possible.
- [ ] Include page data in export outputs.
- [ ] Add tests for multi-page mapping.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add page-aware pdf chunking`.

## 18. Additional keyboard shortcuts
Description: Speed up capture workflows by exposing highlight and note actions via keyboard.
Desired result: Users can trigger core annotation actions without opening context menus.
- [ ] Add new command bindings in manifest.
- [ ] Add handling logic in background worker.
- [ ] Surface shortcuts in settings UI.
- [ ] Handle unsupported or conflicting mappings gracefully.
- [ ] Add tests/manual verification checklist.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add annotation keyboard shortcuts`.

## 19. Annotation review workflow
Description: Add a deliberate review step before final save for queued highlights/notes. Should be optional through settings for users who prefer a more streamlined capture flow.
Desired result: Users can curate annotation sets before persistence.
- [ ] Add pre-save review panel/modal.
- [ ] Allow edit/delete/reorder of queued annotations.
- [ ] Add batch actions (`approve all`, `clear all`).
- [ ] Ensure save uses reviewed state only.
- [ ] Add tests for review-state synchronization.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: add annotation review workflow`.

## 20. Improve UI for highlighting and note-taking
Description: Enhance the user interface for creating and managing highlights and notes to make it more intuitive and user-friendly.
Desired result: Users can easily create, edit, and organize their highlights and notes with a more polished and responsive UI.
- [ ] Redesign the highlight and note creation interface for better usability.
- [ ] Add inline editing capabilities for highlights and notes.
- [ ] Show in the text where highlights are located with better visual cues.
- [ ] show in the text where notes are located with better visual cues.
- [ ] Add options for categorizing and tagging highlights and notes.
- [ ] Implement a more responsive design for different screen sizes.
- [ ] Add tests for the new UI components and interactions.
- [ ] Run `npm run check`, `npm run typecheck`, and `npm test`; resolve failures.
- [ ] Commit with a short message, e.g. `feature: improve highlight and note UI`.
