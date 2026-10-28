# Phase 5 — review and safe template compilation

Implemented 2026-10-28. Scope stops at reviewed template publication; Phase 6
library, fill forms, production rendering and PDF conversion are not included.

## Changes

- Shared `schemas/review.ts` and tests: strict snapshot/publication/error contracts,
  stable UUIDs, source hashes, revision checks, unique keys/identities, limits,
  exact UTF-16 ranges, AI provenance/decisions, type-specific defaults and explicit
  date/locale/currency/precision metadata.
- Drizzle schema and committed `0003_sad_zarek` migration: document reviews,
  template identities and immutable version records. Foreign keys and unique
  document/review and template/version constraints protect publication identity.
- `storage/documents.ts`: reusable integrity-checked access to immutable bytes.
  `storage/reviews.ts`: full review saves with optimistic revisions inside
  immediate SQLite transactions, completed-job provenance validation, preserved
  rejection history, private exclusive compiler files and immutable frozen schemas.
  Compilation precedes a short publication transaction that rechecks revision.
  Concurrent publication of one revision returns the same winning version;
  failed commits remove uncommitted files. Startup removes only unreferenced
  UUID compiler files older than 24 hours, preserving originals and recent writes.
- `services/docx/compiler.ts`: fresh-index verification of selected exact ranges,
  Unicode boundaries, overlaps, text-node coverage and XML container/boundary
  safety. It uses the existing index/UTF-16 conventions, without fuzzy matching
  or a second quote-search algorithm. Explicit human offsets disambiguate names.
  Original XML lexical offsets drive descending text-node edits. Empty nodes,
  run properties, unrelated markup and non-target ZIP entries stay intact.
  Scalar tags/counts, package validity and a Docxtemplater trial render are
  checked before publication. Existing delimiters and unsupported rendering
  structures produce reviewable failures.
- `routes/reviews.ts`, application wiring and integration tests: GET/PUT fields
  and POST publish, strict inputs, no-store responses, bounded sanitized errors.
- Web import/resume and `features/review/`: explicit AI start/polling, no automatic
  approval, manual selections via text selection or offsets, add/edit/remove fields
  and occurrences, ambiguity correction, metadata/default/formatting controls,
  exact source highlights, warnings, save/reload and publish. Document/job UUIDs
  in the URL restore saved state; unsaved edits remain in memory. Failed saves
  preserve edits, and saved revisions must be explicitly published.
- Frontend test dependencies, pnpm lockfile, README and contract status updated.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`: passed.
- 162 tests: 31 shared, 127 API, 4 React workflow tests. Tests are offline and
  require neither Ollama nor LibreOffice.
- Actual compiler output is compared with all three independent corpus expected
  packages at the ZIP-entry byte level, not just the extracted text. This covers
  split runs, Unicode/XML escaping, unrelated reused names, tables, headers,
  footers, formatting structure and unchanged non-target parts/source bytes.
- Additional tests cover adjacent edits, empty-run lexical preservation,
  added spacing preservation, unsafe surrogate/paragraph/bookmark/hyperlink/field
  boundaries, pre-existing delimiters, overlaps, missing blocks, stale hashes and
  revisions, invalid keys/defaults, provenance/decision validation, metadata
  round trips, restart, concurrent publication, failed storage/DB commit cleanup,
  revision changes during compilation, immutable older files and orphan cleanup.
- React tests cover polling, no implicit approval, manual ambiguity correction,
  approval provenance, corrected-range rejection, add/edit/remove, failed-save
  edit retention, reload and publication.
- The empty-run preservation test caught and fixed an unnecessary rewrite of an
  empty `<w:t />` between split spans. Empty spans are now excluded from edits.

## Remaining limits and next phase

The corpus consists of generated valid OPC/OOXML packages; visual verification
in Word/LibreOffice and real-browser visual inspection were not performed.
No new live Ollama run was needed for this phase: deterministic publication and
all tests run without it. Existing real-model quality findings still apply.

A saved review retains one analysis job's decision history; switching that review
to another job is rejected. Manual selections and corrections remain available.
Split-run scalar values inherit the first touched run's styling. Unsupported
structures are conservatively rejected; the UI is a text view, not Word layout.
Files manually removed/corrupted outside the app are not reconstructed. Startup
orphan cleanup deliberately leaves recent files for a later startup and never
removes referenced files or originals. Browser refresh discards unsaved edits.

Launch with `pnpm dev`, then open http://127.0.0.1:5173. Import an untagged DOCX,
review/select occurrences, save and publish. Migrations apply automatically.

Next: **Phase 6 — Template library, forms and document export**.
