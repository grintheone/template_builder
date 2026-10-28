# Phase 3 — DOCX import and source indexing

Implemented and verified on 28 October 2026. Phase 4 has not been started.

## Implementation

`POST /api/documents` accepts one multipart file in the `document` field and returns HTTP 201 with `documentId` and `sourceHash`. It rejects extra fields, incorrect extensions, invalid packages and uploads exceeding configured limits. The original filename is never used as a storage path.

`DocumentStore` validates and indexes the source before saving it byte-for-byte under the configured storage directory's `originals/<uuid>.docx`. Files use exclusive creation and owner-read-only permissions. SQLite stores the generated ID, private path, SHA-256 hash and creation timestamp. A failed database insert removes the newly written file. There is no source-edit endpoint.

`GET /api/documents/:id/blocks` validates the ID, loads the persisted record, checks the private path and source hash, and returns the source index. Invalid IDs return 400; missing records return 404. Integrity/storage failures return sanitized 500 errors. Import and index responses use `Cache-Control: no-store`.

The indexer uses PizZip and xmldom without serializing or changing source XML. It indexes body paragraphs, table cells, numbered header/footer parts, Unicode, repeated text, blank paragraphs and phrases split across runs. Each block contains a stable part-path/paragraph-index ID, section, structural location, text, support status, warnings and text-node spans. Span offsets use UTF-16 code units; text-node indices refer to all original `<w:t>` elements in the part, allowing later code to recover the exact nodes from the immutable XML.

Import reuses bounded ZIP validation from Phase 2: signature, compressed upload size, advertised/actual expansion, entry count, encryption, compression method, symlinks, unsafe paths, required package parts, conservative OPC allowlist and XML parsing checks. Import mode permits selected unsupported XML structures for inspection while rendering retains its stricter rejection behavior. Unsupported package parts remain rejected.

Tracked edits, field codes, text boxes, drawings, content controls, hidden text and unknown paragraph structures disable replacement for affected blocks. Complex-field state carries across paragraphs. Nested paragraphs are indexed separately. Tabs and line breaks retain display offsets without invented text-node mappings and make the paragraph unsupported for replacement. Document warnings also identify selected constructs outside paragraphs and unindexed notes. Indexing is capped at 20,000 paragraphs.

The dashboard now includes an upload form and scrollable extracted-text view, with saved ID/hash, structural locations and highlighted warnings. No document content is sent to AI.

## Files added

- `packages/shared/src/schemas/documents.ts`
- `packages/shared/src/schemas/documents.test.ts`
- `apps/api/src/services/docx/indexer.ts`
- `apps/api/src/services/docx/indexer.test.ts`
- `apps/api/src/storage/documents.ts`
- `apps/api/src/routes/documents.ts`
- `apps/api/src/routes/documents.test.ts`
- `apps/api/drizzle/0001_flat_tusk.sql`
- `apps/api/drizzle/meta/0001_snapshot.json`
- `apps/web/src/features/documents/DocumentImport.tsx`
- `PHASE_3_REPORT.md`

## Files modified

- `packages/shared/src/index.ts`: export document contracts.
- `apps/api/src/app.ts`: register import/index routes.
- `apps/api/src/db/schema.ts`: add immutable source records.
- `apps/api/drizzle/meta/_journal.json`: register the migration.
- `apps/api/src/services/docx/validate-package.ts`: add import validation mode while preserving strict rendering behavior.
- `apps/web/src/App.tsx`: include source import and extracted-text UI.
- `README.md`: document import workflow, endpoints, persistence, span semantics, limits and next milestone.

No new dependencies, commits or pushes were made. Existing work was preserved.

## Verification

| Check | Result |
| --- | --- |
| `pnpm db:generate` | Passed; generated the documents migration and metadata |
| `pnpm lint` | Passed; 64 files checked at implementation completion |
| `pnpm typecheck` | Passed for all workspaces |
| `pnpm test` | Passed; 94 tests across 11 test files: 76 API and 18 shared |
| `pnpm build` | Passed for shared, API and web |
| Browser interaction / Word inspection | Not performed for Phase 3 |
| Real Ollama / LibreOffice | Not required or invoked for Phase 3 |

API integration tests use Fastify inject and isolated temporary SQLite databases/private storage. They verify exact stored bytes, SHA-256, stable indices across API restart, rejection of tampered sources, invalid IDs, missing documents, invalid extensions, malformed ZIP/XML, missing main document, path traversal, non-allowlisted parts, encryption, compressed upload limits and expanded-part limits. Existing renderer, configuration, readiness and migration tests remain green.

Indexer tests cover body/table/header/footer text, split runs and exact UTF-16 offsets, Cyrillic/emoji, repeated values, blank paragraphs, structural locations, tracked edits, fields spanning paragraphs, text boxes, unsupported content outside paragraphs, tabs and breaks. Shared tests cover document response contracts and invalid identifiers. The web workspace has no automated component tests; its test command passes with no test files.

## Issues encountered

- Initial indexer tests exposed that the main `document` ancestor was incorrectly classified as unsupported. Its structural classification was corrected, and the tests pass.
- Typechecking caught an inferred `void` return in the frontend error helper. Its return type now explicitly states `Promise<never>`.
- The implementation summary was initially delivered only in chat. This report was added afterward to match the existing Phase 1/2 report convention. No implementation code changed while adding the report.

## Launch and try

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. Under **Import a source DOCX**, choose a standard `.docx` and select **Import and inspect**. Inspect the ID/hash, extracted paragraphs and warnings. Optionally generate a sample with `pnpm demo:fixture`; its existing tags are treated as ordinary text during import. Startup applies committed migrations automatically.

## Remaining limits and next milestone

This is an extracted-text view, not a Word-layout preview. Unsupported blocks may contain incomplete visible text and are not safe replacement targets. Footnotes/endnotes are preserved but not indexed. The package allowlist rejects macros, embedded-object packages, charts, custom XML and signed packages. Read-only permissions and hash checks protect application behavior and detect modification; they do not prevent the local file owner from changing filesystem permissions or files.

No AI analysis, quote resolution, field review, template compilation/publication, library forms or PDF export was added. The next milestone is **Phase 4 — Ollama-backed AI field suggestions**.
