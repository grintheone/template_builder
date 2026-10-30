# Phase 4 — Ollama-backed AI field suggestions

Implemented on 28 October 2026. Existing Phase 3 work was verified and committed first as `97775af` (`feat: import immutable DOCX sources and index document blocks`), as requested. Phase 4 is recorded in a separate commit.

## Implementation and modified files

- `packages/shared/src/schemas/analysis.ts` and `index.ts`: strict Zod contracts for candidate metadata, exact source evidence, resolved/unresolved occurrences, results, errors and durable job states. Added contract tests in `schemas/analysis.test.ts`.
- `apps/api/src/services/ai/field-detector.ts`: official Ollama client, environment-selected endpoint/model, JSON-schema-constrained output, temperature zero, thinking disabled and no tools. Installed Ollama source was inspected to verify chat options and non-streaming cancellation behavior. The existing dependency was sufficient; no dependencies changed.
- `apps/api/src/services/ai/match-resolver.ts`: deterministic, case-sensitive matching within a specific block, optional immediately adjacent context, overlapping duplicate detection and exact UTF-16 offsets. Unknown, invented, ambiguous and unsupported matches retain their evidence with an unresolved reason. No document text is normalized or rewritten.
- `apps/api/src/services/ai/errors.ts`: sanitized actionable error codes/messages; raw model and transport errors are not exposed.
- `apps/api/src/storage/analysis-jobs.ts`: SQLite-backed records, one running worker, eight pending/admitting requests, duplicate active-document job reuse, whole-job deadline, HTTP cancellation, durable results/failures, and interrupted-job recovery on startup/shutdown. Source bytes/hash are checked before queuing and again before detection.
- `apps/api/src/routes/analysis.ts` and `app.ts`: start analysis with HTTP 202/Location; poll durable jobs; validate IDs and reject supplied request bodies; return no-store responses, 404s and bounded-queue 429s.
- `apps/api/src/db/schema.ts`, `drizzle/0002_brainy_sway.sql`, migration snapshot and journal: durable analysis jobs referencing immutable documents.
- `apps/api/src/config.ts`, `config.test.ts`, `.env.example`: configurable `ANALYSIS_TIMEOUT_MS` (default 120,000; range 1,000–600,000), bounded model names and rejection of cloud-named models. Loopback-only endpoint restrictions remain enforced.
- `apps/api/src/services/ai/field-detector.test.ts` and `routes/analysis.test.ts`: mocked client and Fastify integration coverage. `routes/documents.test.ts` now asserts that rejected imports leave storage empty; startup recovery initializes the storage directory before uploads.
- `README.md`: API walkthrough, operational limits, failure/retry behavior, privacy, configuration and next milestone.

Source blocks are chunked without splitting a block. Same-key fields and identical occurrences are merged; minimum confidence is retained. Contradictory type/required metadata makes that key's occurrences unresolved. Missing or invalid AI output fails the job without saving partial results. No result counts as human approval.

Limits include 64 chunks, 12,000 serialized characters per chunk, 1 MiB transport response bodies, 8,192 generated tokens per request, 500 merged fields, 1,000 occurrences per field and 2,000 total occurrences. An oversized individual block fails explicitly rather than being truncated. Entire jobs, including source verification and every chunk, share a deadline. Blank blocks are skipped. Redirects are refused; non-streaming requests receive the job's abort signal through the client's fetch implementation.

## Verification

| Check | Result |
| --- | --- |
| `pnpm db:generate` | Passed; generated analysis-jobs migration and metadata |
| `pnpm lint` | Passed; no warnings or errors |
| `pnpm typecheck` | Passed for every workspace |
| `pnpm test` | Passed; 130 tests: 101 API and 29 shared, across 14 files |
| `pnpm build` | Passed for shared, API and web |
| `git diff --check` | Passed |
| Real Ollama inference | Not performed; client calls use fakes in tests |
| Browser / Word / LibreOffice inspection | Not performed; this milestone adds no UI or document editing |

Tests cover successful exact extraction, Unicode offsets, invented quotes/block IDs, duplicate/overlapping text, adjacent context, unsupported source blocks, whole-block chunking and limits, deduplication, metadata conflicts, malformed JSON, schema violations, oversized responses, offline Ollama, missing models, abort signals, timeouts, continued queue processing, durable results and source hashes, unchanged original bytes, queue capacity, active-request reuse, startup recovery for both pending and running jobs, shutdown cancellation and sanitized errors.

Malicious-document tests verify that instructions stay in the separate untrusted-data message, never the system instruction, and that output remains constrained to candidate metadata/evidence. They cannot establish that a real model will obey every instruction; deterministic validation and human review remain necessary. Tests require neither Ollama nor LibreOffice. The web test command passes with no component tests.

## Try it

Run `pnpm dev` and open http://127.0.0.1:5173. Import a DOCX and copy its document ID. Start the local Ollama service with the configured downloaded model available, then:

```sh
curl --fail-with-body -X POST http://127.0.0.1:3001/api/documents/DOCUMENT_ID/analyze
curl --fail-with-body http://127.0.0.1:3001/api/analysis-jobs/JOB_ID
```

Substitute the returned UUIDs. Poll until `done` or `failed`. Missing services/models produce durable actionable errors; restart-interrupted work requires an explicit new analysis.

## Remaining limitations and next milestone

Phase 4 is API-only. No approval/editing UI, template compilation/publication, saved-template forms or PDF export was added. Suggestions never mutate the source or automatically publish a template. Exact matches establish source location, not semantic correctness or final XML edit safety; overlap checks and compiler safety validation belong to Phase 5. Different model keys with equivalent meaning still require human consolidation. Chunk-local context may miss relationships across blocks/chunks. A timeout or invalid chunk discards partial suggestions. Recovery assumes one local API process owns the database; concurrent API instances are not supported.

Next: **Phase 5 — Field review UI and safe template compilation**.
