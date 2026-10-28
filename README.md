# Local AI DOCX Template Studio

A single-user web app for working with reusable DOCX templates on your computer. **Phases 1–5 are implemented:** local services, tagged DOCX rendering, immutable source import/indexing, local AI suggestions, human review and safe compilation into immutable template versions.

## Requirements and launch

- Node.js **22.12 or later** (a supported LTS recommended), pnpm **10.14.0**.
- Ollama with the configured local model is required for AI analysis. Import, manual review, template compilation, tagged DOCX rendering and automated tests work without it. LibreOffice remains optional.

From the repository root:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://127.0.0.1:5173**. Fastify listens on **http://127.0.0.1:3001**. Vite proxies `/api` to Fastify, so the browser uses same-origin requests without a CORS workaround. `pnpm dev` first builds the shared package, then starts both servers with file watching. Stop both with Ctrl+C. If shared contracts change, restart `pnpm dev` to rebuild them.

The API creates `data/app.sqlite`, applies committed migrations, and creates `data/storage/` on startup. Nothing needs to be seeded. Runtime data, SQLite sidecars, environment secrets, dependencies, and build artifacts are gitignored.

## Import and inspect a DOCX

Start with `pnpm dev`, open **http://127.0.0.1:5173**, and use **Import a source DOCX**. Choose a standard `.docx` and click **Import and inspect**. The page displays the saved document ID, SHA-256 hash, source paragraphs and structural warnings. The existing `pnpm demo:fixture` sample can also be imported; its tags are treated as ordinary source text.

`POST /api/documents` accepts multipart/form-data with exactly one file in the `document` field and no additional fields. It returns HTTP 201 with `{ documentId, sourceHash }`. `GET /api/documents/:id/blocks` returns those identifiers plus `blocks` and document-level `warnings`. Invalid IDs return 400; missing documents return 404. Both responses disable caching. Upload limits return 413; unsupported or invalid documents return sanitized 422 errors.

Original uploads are stored byte-for-byte under `data/storage/originals/<server-generated-uuid>.docx`, with exclusive creation and read-only owner permissions. SQLite stores their private path, hash and creation time. The original filename is never used as a storage path. Re-reading an index verifies the hash first; a changed/missing source fails with a sanitized error. Restarting the API retains documents and stable block IDs. There is no source-edit or delete endpoint.

Indexing covers body paragraphs, table cells, numbered headers/footers, repeated text, Unicode, split runs and blank paragraphs. A block ID combines the original part path and zero-based paragraph index; `location` records table/row/cell ancestry. `spans` maps UTF-16 start/end offsets into the block text to the zero-based `<w:t>` element index in the original XML part. It includes all text nodes when assigning indices, so later code can recover the exact nodes by parsing the immutable part. No XML is rewritten during import.

Tracked changes, field codes, text boxes, drawings, content controls, hidden text and unknown paragraph structures require manual review. Affected blocks are marked unsupported; their extracted text may be incomplete and cannot be treated as a safe replacement span. Tabs and breaks retain display offsets but disable replacement for the paragraph. Nested text-box paragraphs are indexed separately. Footnotes/endnotes remain preserved but are not indexed. Package-level warnings identify unsupported constructs even when they contain no paragraph. Macro/embedded-object packages, unsupported OPC parts, encryption, invalid XML and unsafe ZIP paths are rejected outright. The index has a 20,000 paragraph limit in addition to package limits.

Import and indexing do not call AI. Analysis is a separate explicit API action below. The review UI and compiler are described below. Word-layout previews are not implemented.

## Analyze with local Ollama

Install/start Ollama and download the configured local model (`ollama pull qwen3:8b`). After importing a source in the dashboard, copy its document ID. Start analysis with an empty POST body:

```sh
curl --fail-with-body -X POST http://127.0.0.1:3001/api/documents/DOCUMENT_ID/analyze
# Returns HTTP 202: {"jobId":"..."}; Location points to the polling endpoint.
curl --fail-with-body http://127.0.0.1:3001/api/analysis-jobs/JOB_ID
```

Replace `DOCUMENT_ID` and `JOB_ID` with the returned UUIDs. Poll about once per second until `status` is `done` or `failed`. Responses disable caching. Job records contain the source hash, configured model, timestamps, status, and either `result` or a sanitized `error`. Suggestions include snake_case keys, labels, scalar types, required flags, confidence, and explicit source occurrences. Each occurrence retains `blockId`, exact `quote`, optional adjacent context and a generated ID. A `resolved` occurrence has UTF-16 `start`/`end` offsets; an `unresolved` occurrence has a reason and no offsets. Neither status constitutes human approval.

Missing quotes, unknown block IDs, ambiguous repeated quotes, mismatched context, unsupported blocks and conflicting type/required metadata remain unresolved for review. Same-key occurrences are merged and exact duplicates removed; conflicting metadata requires review. Different keys with the same meaning are not automatically combined. Review saves and publication validate overlaps and final XML-span safety. No replacement, source mutation, template publication or rendering is performed by analysis. The dashboard also starts/polls analysis and lets you review suggestions.

Jobs are persisted in SQLite before work starts. One job runs at a time with up to eight queued/admitting requests; excess requests return 429 with `Retry-After`. Repeated requests for the same active document return the existing job ID when capacity is available. Completed results and failures survive restarts. Pending/running jobs found at startup, or left at shutdown, become `failed` with `INTERRUPTED`; explicitly start a new analysis to retry. Invalid IDs/bodies return 400; missing documents/jobs return 404. Source-integrity failures return a sanitized 422 before queuing or a failed job if detected during processing.

The detector uses the official Ollama client with JSON Schema output, temperature 0, no tools and thinking disabled. Indexed text is explicitly marked as untrusted document data in a separate user message. Only the configured loopback endpoint is contacted, redirects are refused, and cloud-named models are rejected by configuration. Configure a downloaded local model. Prompt instructions cannot guarantee model behavior: Zod and deterministic source matching check its output, and a person must assess every suggestion. Schema violations and malformed/truncated JSON fail the whole job rather than silently dropping candidates.

Limits: whole source blocks are chunked into at most 64 requests of 12,000 serialized characters each; oversized individual blocks fail explicitly rather than being truncated. Blank blocks are skipped. The model response body is capped at 1 MiB before JSON parsing, each request permits up to 8,192 generated tokens, and analysis retains at most 500 keys and 2,000 distinct occurrences overall (1,000 per key). The entire job, including source verification and all chunks, defaults to a 120-second timeout. Cancellation aborts non-streaming HTTP requests. Raise `ANALYSIS_TIMEOUT_MS` (1,000–600,000) or use a smaller document when needed. A failure saves no partial suggestions. Errors distinguish offline Ollama, missing model, invalid output, limits, timeout and interrupted work; raw model/network errors are never logged or returned.

## Review fields and publish a template (Phase 5)

1. Import a populated DOCX without `[[` or `]]` text. The already-tagged demo is
   for the separate renderer and cannot be published as a new source template.
2. Click **Start local AI analysis**, or add manual selections without Ollama.
   Polling displays progress and actionable failures. Suggestions remain pending
   until you explicitly approve or reject each occurrence. The current model may
   suggest whole paragraphs: manually select just the intended scalar value.
3. Use **Select source text** to drag-select an exact range, or enter UTF-16 start
   and exclusive end offsets. Choose an existing field to reuse its key, or give
   a new field a snake_case key. Unsupported paragraphs are disabled. Correcting
   an ambiguous suggestion manually records its original occurrence as rejected.
4. Edit keys, labels, types, required flags, defaults and formatting. Remove any
   unwanted fields/occurrences. Source highlights show approved locations; an
   identical value elsewhere stays untouched. Cross-run replacements inherit the
   first run's formatting, retaining surrounding runs and their properties.
5. Click **Save review**, then **Publish saved review**. Each save increments the
   review revision; unsaved changes disable publishing. Conflicts keep your edits
   visible; explicitly reload saved state to discard them. Publication failures
   also retain the saved review for correction/retry.

The URL remembers the document and active job IDs, so refresh can restore saved
review/polling state. Bookmark it, or paste the document ID into **Resume a saved
document ID**. Unsaved edits stay in memory only. Suggestion decisions in a saved
review remain tied to one completed analysis job; later analyses cannot replace
those decisions. Manual edits remain available. The UI is an extracted text view,
not a Word layout preview.

`GET /api/documents/:id/fields` returns revision 0 for a source with no saved review.
`PUT /api/documents/:id/fields` replaces the complete snapshot, using `sourceHash`,
`expectedRevision`, optional `analysisJobId`, `fields` and `decisions`; see the
strict shared schemas in `packages/shared/src/schemas/review.ts`. Quotes, offsets,
Unicode boundaries, provenance, overlap, defaults and formatting are verified on
the server. Omitting/deleting an accepted AI occurrence requires an explicit
rejected decision. Limits are 100 fields and 2,000 approved occurrences; review
JSON is limited to 4 MiB.

`POST /api/documents/:id/publish` accepts only `{ sourceHash, reviewRevision }` and
compiles the saved selection. It returns template/version UUIDs, version number,
review revision, source hash, timestamp and frozen field schema, with no private
paths. Publishing the same current revision returns the same version. Saving
and publishing another review creates a new version under the same template;
older schemas and files remain immutable. All review responses disable caching.
Invalid shapes return 400, missing records 404, conflicts 409, unsafe/invalid
selections or templates 422, and storage/commit failures sanitized 500 errors.

The compiler verifies the original hash, rebuilds the index and patches only
approved `<w:t>` text using original XML coordinates. It preserves untouched
markup in changed parts and every non-target ZIP entry's contents. Overlaps,
unsafe Unicode boundaries, cross-paragraph/hyperlink/bookmark/permission/field-code
ranges and existing delimiters fail explicitly. Compiled tag counts must match
approved occurrences; package validation and a scalar-only Docxtemplater trial
render must pass before a file/version is committed. No AI is used in compilation.
Some otherwise untouched unsupported constructs can prevent publication because
the existing renderer cannot safely process them.

Compiled files are private, exclusively created under `data/storage/templates/`.
A short SQLite transaction rechecks the revision after compilation; failed
commits remove unpublished files. Startup removes UUID-named unreferenced compiler
files older than 24 hours, preserving recent in-flight writes, referenced versions
and all originals. This handles process-crash orphans; it does not repair files
manually removed or corrupted outside the app.

## Try the Phase 2 DOCX renderer

Start the app with `pnpm dev`, then generate a representative, already-tagged sample:

```sh
pnpm demo:fixture
```

On the dashboard, use **Try a tagged DOCX** to choose `data/storage/demo-tagged.docx` (or the configured storage directory). It includes a styled title, repeated and split-run tags, a table, header/footer, numbering and a small image. Keep the sample JSON or enter:

```json
{
  "client_name": "Иван Smith",
  "amount": 1250.5
}
```

Click **Render and download DOCX** and open `rendered.docx` in Word or LibreOffice. Repeat with different values to check that the original stays unchanged. No Ollama request or LibreOffice invocation occurs during DOCX rendering.

For a custom template, manually insert `[[client_name]]`, `[[amount]]`, or other scalar tags in Word. Every distinct tag is required in this proof of concept. Values must have exactly the matching snake_case keys, with text or finite numbers. An explicit empty string means blank; missing and unknown keys are rejected. Strings are inserted as text with XML escaping; embedded markup is never interpreted. Newlines become Word line breaks. Numbers use their JavaScript decimal representation; locale/date/currency formatting is deferred to later phases.

The development endpoint is `POST /api/dev/render`. It is deliberately separate from the planned saved-template render endpoint because no template is stored or published here. It accepts multipart/form-data with exactly one `template` file and one `values` JSON field, in either order:

```sh
curl --fail-with-body \
  -F 'template=@data/storage/demo-tagged.docx' \
  -F 'values={"client_name":"Alex Smith","amount":5000}' \
  http://127.0.0.1:3001/api/dev/render \
  -o data/storage/rendered.docx
```

A successful response is a DOCX attachment named `rendered.docx`. Validation failures return sanitized `{ "code": "…", "message": "…" }` JSON with HTTP 422, multipart syntax failures can return 400, and upload/expansion limits return 413. Internal errors are sanitized and return 500. No document text or submitted values are logged.

### Rendering limits

- `.docx` only, validated as an unencrypted ZIP/OPC package with required main document, content types and relationships. Corrupt archives, unsafe paths, macros and non-allowlisted parts are rejected. XML must be well-formed UTF-8 without DTDs/entities.
- Only scalar text replacements in body paragraphs, table cells, headers and footers. Loops, conditions, expressions, raw XML/image substitution, tracked edits, text boxes, embedded objects and field codes are outside this proof of concept. Tags in other text parts are rejected rather than left silently unfilled. Charts, custom XML and signed packages are also outside its conservative package allowlist.
- Uploads default to 15 MiB; values JSON is limited to 64 KiB, 100 fields, and 10,000 characters per string. ZIP expansion is limited to 1,000 entries, 10 MiB per part and 50 MiB total. Output expansion is conservatively bounded before rendering, so unusually large repeated or multiline values can be rejected.
- All non-target ZIP part contents remain byte-identical. Docxtemplater handles text-run replacement inside target parts; the whole ZIP container is regenerated. Source input bytes are never mutated.
- Unicode text is preserved. Its appearance in Word/LibreOffice depends on locally available fonts; install suitable fonts if characters appear blank or as boxes. This is not a pixel-perfect Word preview.

## Configuration

The API loads the root `.env` regardless of its working directory. Existing environment variables take precedence. Defaults work without an `.env` file.

| Variable | Default / purpose |
| --- | --- |
| `HOST` | `127.0.0.1`; external bindings are rejected |
| `API_PORT` | `3001`; Vite uses the same configured port |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434`; only loopback HTTP(S) endpoints are accepted |
| `OLLAMA_MODEL` | `qwen3:8b`; downloaded local models only, cloud-named models rejected |
| `ANALYSIS_TIMEOUT_MS` | `120000`; whole-job deadline, 1,000–600,000 milliseconds |
| `DATABASE_PATH` | `./data/app.sqlite` |
| `STORAGE_DIR` | `./data/storage` |
| `MAX_UPLOAD_MB` | `15`; maximum DOCX upload size in MiB |
| `SOFFICE_PATH` | `soffice` on PATH, or the explicit executable path in `.env.example` |

Database and storage paths resolve relative to the repository and must stay inside `data/`; existing symlink paths are rejected. Keep `.env` private. The development rendering route processes uploads and results in memory without saving them. The import route retains immutable originals on private local disk. The demo-fixture command explicitly writes its sample under `data/storage/`. Browser downloads go to your browser's configured download location.

For optional local services on macOS, install/launch Ollama using its official app, then run `ollama pull qwen3:8b`. Install LibreOffice and set `SOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice` if it is not on PATH. This phase checks the binary using `--version`; actual PDF conversion is a later milestone.

`GET /api/health` returns HTTP 200 while optional services are offline. It distinguishes Ollama server availability from configured-model availability and includes actionable messages. Each check has a two-second timeout. The dashboard refreshes every 15 seconds. It reports unknown status if the API cannot be reached.

## Commands

Run these from the repository root:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate
```

Preparation for Phase 5 is documented in [the readiness report](docs/PRE_PHASE_5_READINESS.md)
and [the approval/publication contract](docs/PHASE_5_CONTRACT.md). Phase 5 implements the compiler
and review workflow. Its compiler tests compare actual output against the independent
source/expected-template acceptance fixtures, including all ZIP entry bytes.

To run the opt-in live detector checks against three synthetic DOCX packages:

```sh
pnpm smoke:analysis
```

This requires local Ollama and the configured model. It saves synthetic sources,
private suggestion JSON and a count-only report under a new ignored
`data/storage/readiness-<uuid>/` directory (or the configured storage directory).
It does not import documents into SQLite or publish templates. Passing safety
checks does not mean complete/correct detection: check `detectionQuality` and the
expected-location counts. Current `qwen3:8b` smoke results require manual review,
including trimming whole-paragraph suggestions to the intended values. Ordinary
`pnpm test` remains offline and does not run these model calls.

`pnpm lint` uses Biome with Tailwind-aware parsing. `pnpm test` builds shared contracts first and runs shared-schema, API and stateful React review tests, including mocked offline services and Ollama suggestions, quote resolution, untrusted prompt boundaries, chunking/deduplication, timeout cancellation, durable job recovery/queue limits, invalid configuration, sanitized errors, migration and source persistence, generated DOCX fixtures, indexing and split-run offsets, source integrity failures, rendering/formatting preservation, and multipart failure cases. Tests do not require Ollama or LibreOffice. Database tests create and remove isolated temporary databases under ignored `data/storage/`.

`pnpm db:generate` generates a Drizzle migration from API schema changes; inspect and commit the SQL and metadata. `pnpm db:migrate` applies committed migrations; startup also applies them idempotently.

To check the production builds locally:

```sh
pnpm build
pnpm start
# In another terminal:
pnpm --filter @studio/web exec vite preview
```

Open http://127.0.0.1:4173. `pnpm start` runs the built API; Vite preview proxies `/api` to it. Both development and preview bind to loopback.

## Workspace

- `apps/web`: React, Vite, Tailwind CSS v4, shadcn-compatible component aliases, CSS tokens and Button; TanStack Query drives readiness, source loading and analysis polling. React Hook Form handles manual range selection and the tagged-DOCX demo; published-template input forms are Phase 6.
- `apps/api`: Fastify, bounded multipart uploads, DOCX package validation, Docxtemplater/PizZip renderer, local readiness services, and SQLite/Drizzle migrations.
- `packages/shared`: shared Zod health, render-value and error contracts with inferred TypeScript types.

There is no cloud AI, external document service, telemetry, or remote font dependency. Readiness and explicitly requested AI analysis contact only the configured loopback Ollama endpoint. Readiness invokes the configured local LibreOffice executable without a shell. No document contents or filled values are logged.

## Troubleshooting and scope

- API startup error: check `.env`, writable `data/`, or an occupied `API_PORT`. Invalid local-only settings fail closed with a sanitized error.
- Port 5173 already in use: stop the conflicting process; Vite uses a strict port.
- Ollama unavailable: start the local service and verify the endpoint. A running service without the selected model shows a separate model-install message.
- LibreOffice unavailable: check installation and the executable path. DOCX rendering still works without it. PDF export is a later milestone.
- Native SQLite installation fails: use a supported Node LTS and reinstall dependencies. A compiler toolchain may be needed if a prebuilt binary is unavailable. pnpm is configured to allow the required SQLite/esbuild install scripts.

Next milestone: **Phase 6 — Template library, forms and document export**. The saved-template library, dynamic fill forms, production rendering endpoint and PDF conversion are not implemented yet.
