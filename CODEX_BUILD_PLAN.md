# Local AI DOCX Template Studio — implementation plan for Codex

## Intended result
A user launches a local web app, imports a fully populated `.docx`, receives Ollama-suggested customizable values, approves or adjusts those values, saves a reusable DOCX template, fills out an auto-generated form, and downloads a completed DOCX or PDF. No document content is sent to a cloud AI service.

Work in **seven separately reviewed phases**. Give Codex one phase prompt at a time. Place `AGENTS.md` and this file in the repository root first. Codex recognizes `AGENTS.md` as persistent repository guidance.

### Important product decision
**AI detects candidate replacement values; deterministic code applies them.** Do not let a model recompose a DOCX, and do not globally find-and-replace values just because they appear identical. Preserve every non-replaced part of the document.

### v1 constraints
- Only `.docx`, not `.doc`, `.docm`, PDF ingestion or scanned pages.
- Textual scalar fields: `text`, `date`, `number`, `currency`.
- Analyze visible text in supported body paragraphs, table cells, headers and footers. Disclose limitations for tracked changes, text boxes, complex fields, embedded objects, etc.
- Single-user local-first app; no authentication or remote deployment.
- No conditional clauses, repeated rows, signature/image replacement in v1.
- The system should allow manual fallback when AI detection is imperfect.

## Environment preparation on macOS
Prerequisites: a recent Node.js LTS (>=22), pnpm, Ollama, LibreOffice, Git and Codex locally in the chosen working directory.

Suggested setup, where Homebrew is available:

```sh
brew install node pnpm
brew install --cask libreoffice
# Install/launch Ollama via https://ollama.com/download
ollama pull qwen3:8b
ollama list
```

Ollama's local API normally listens on `http://127.0.0.1:11434`. If `soffice` is not on `PATH`, the macOS binary is typically `/Applications/LibreOffice.app/Contents/MacOS/soffice`. Configure that path in `SOFFICE_PATH` rather than hard-coding assumptions. Use the official Ollama app/service to start the server. Initial installations and model downloads need internet; the application can operate offline afterward.

Recommended `.env.example`:

```dotenv
HOST=127.0.0.1
API_PORT=3001
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
DATABASE_PATH=./data/app.sqlite
STORAGE_DIR=./data/storage
MAX_UPLOAD_MB=15
SOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice
```

Keep all private and generated data directories out of git.

## Intended repository organization

```text
local-docx-studio/
├── AGENTS.md
├── CODEX_BUILD_PLAN.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── web/
│   │   └── src/{pages,components,features,lib}/
│   └── api/
│       └── src/
│           ├── routes/
│           ├── services/{docx,ai,templates,pdf}/
│           ├── db/
│           ├── storage/
│           └── server.ts
├── packages/
│   └── shared/src/{schemas,types}/
└── data/                 # gitignored
    ├── app.sqlite
    └── storage/
```

## Data contracts (design target)

**SourceBlock** (created from Word XML, never by the model):

```ts
type SourceBlock = {
  id: string; // e.g. 'word/document.xml::p-000042'
  partPath: string; // 'word/document.xml', 'word/header1.xml', etc.
  paragraphIndex: number; // stable within the immutable imported document
  section: 'body' | 'header' | 'footer';
  text: string; // visible text from supported w:t elements
  supported: boolean;
  warning?: string;
};
```

**SuggestedField** (untrusted model result, subsequently validated):

```ts
type SuggestedField = {
  key: string;                // snake_case; canonical key
  label: string;
  type: 'text' | 'date' | 'number' | 'currency';
  required: boolean;
  confidence: number;         // clamp/validate 0..1
  occurrences: Array<{
    blockId: string;
    quote: string;            // exact source substring, NOT a replacement rewrite
    contextBefore?: string;
    contextAfter?: string;
  }>;
};
```

The server resolves `quote` to an actual location. If the quote does not appear, appears multiple times without enough evidence, spans an unsupported XML structure, or overlaps a different accepted match, mark it **unresolved**, never guess. Multiple occurrences can intentionally map to the same key.

**ReviewedField**: approved key/label/type/required/default/formatting metadata plus explicit, verified occurrence IDs and resolver offsets. Rejections are stored so subsequent analysis is not treated as approval.

**TemplateVersion**: version ID, source document ID, compiled DOCX path, form-schema JSON, source hash, creation timestamp, status. A published version is immutable; edits create a new version.

**RenderPayload**: values keyed by field key, with no unknown keys. Validate on the server before rendering. Format dates and currency deterministically with configured locale/format rather than model-generated text.

Suggested SQLite entities: `documents`, `analysis_jobs`, `templates`, `template_versions`, `fields` (or versioned schema JSON), `occurrences`. Keep generated files temporary by default rather than retaining sensitive filled documents indefinitely.

## REST API target

| Method | Route | Result |
|---|---|---|
| GET | `/api/health` | API, Ollama and LibreOffice readiness |
| POST | `/api/documents` | Multipart DOCX import; returns `documentId` |
| GET | `/api/documents/:id/blocks` | Indexed source paragraphs and warnings |
| POST | `/api/documents/:id/analyze` | Starts async local AI analysis; returns `jobId` |
| GET | `/api/analysis-jobs/:jobId` | Pending/running/done/failed + suggestions |
| PUT | `/api/documents/:id/fields` | Review/approve field definitions & occurrences |
| POST | `/api/documents/:id/publish` | Validates and compiles immutable template version |
| GET | `/api/templates` | Saved templates |
| GET | `/api/templates/:id` | Metadata and dynamic form schema |
| POST | `/api/templates/:id/render` | Validates form and streams `.docx` or `.pdf` |
| GET | `/api/documents/:id/preview` | Optional PDF preview, if LibreOffice available |

Use Fastify `inject()` for integration tests; document response types in shared Zod schemas. Adapt precise route structure only when you have a clear, documented reason.

---

# Phase 1 — Repository scaffold and local services

**Codex prompt (paste into Codex):**

> Read `AGENTS.md` and `CODEX_BUILD_PLAN.md`. Implement **Phase 1 only**. Scaffold a pnpm workspace with `apps/web` (React/Vite/TS, Tailwind, shadcn/ui-compatible setup, TanStack Query, React Hook Form), `apps/api` (Fastify/TS), and `packages/shared` (Zod contracts). Create `.env.example`, `.gitignore`, lint/typecheck/test/build scripts, README, and a minimal SQLite/Drizzle setup with migrations. Store database and uploaded files only under ignored local `data/`. Bind Fastify to `127.0.0.1:3001`; configure Vite development proxy so the browser calls `/api` without a CORS workaround. Add GET `/api/health` that reports availability of the API, configured Ollama endpoint/model, and LibreOffice binary without failing the whole service if dependencies are offline. Build a simple dashboard showing their status. Ensure `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm test`, and `pnpm build` work. Add at least one backend route test and one shared schema test. Stop after Phase 1 and report exactly how to launch the app.

**Acceptance:** The React page opens locally, the health API responds, and automated checks pass even when Ollama is unavailable.

# Phase 2 — Deterministic DOCX rendering proof of concept

**Codex prompt:**

> Implement **Phase 2 only**. Before integrating AI, prove reliable DOCX rendering with `docxtemplater` and `pizzip`. Create a `DocxRenderer` service that takes a DOCX buffer already containing `[[field_name]]` placeholders and validated key/value data, renders a new DOCX buffer, and does not mutate the input. Configure `delimiters: { start: '[[', end: ']]' }`. Reject unknown/missing required keys and template parsing errors; do not allow missing fields to render as `undefined`. Add a small development page or API route to upload an already-tagged DOCX, enter sample values, and download a generated DOCX. Write tests covering paragraphs, table cells, headers/footers where supported, repeated placeholders, non-ASCII text, missing fields and malformed tags. Generate representative sample fixtures programmatically for tests if practical. Do not build AI detection or template compilation yet. Keep all previous checks green.

**Acceptance:** A DOCX with manually inserted `[[client_name]]` tags can be populated repeatedly and opens in Word/LibreOffice with the surrounding formatting intact.

# Phase 3 — DOCX import and source indexing

**Codex prompt:**

> Implement **Phase 3 only**. Add a secure Fastify multipart upload for `.docx` and a local immutable source document store. Reject `.doc`, `.docm`, invalid ZIP containers, missing `word/document.xml`, excessive compressed/uncompressed size, encrypted/unsupported documents, and path-traversal ZIP entries. Parse selected OOXML parts with `pizzip` and `@xmldom/xmldom`: `word/document.xml`, supported `word/header*.xml`, and `word/footer*.xml`. Build `SourceBlock[]` with stable part + paragraph IDs, displayed text, structural location, and warnings for unsupported content. Preserve a mapping from each block's character spans to the original `<w:t>` text nodes so a later compiler can resolve text even when Word splits a phrase across multiple runs. Test body paragraphs, table cells, headers, footers, split runs, Unicode, repeated text, blank paragraphs, and unsupported constructs. Persist original document path and SHA-256 hash. Implement `POST /api/documents` and `GET /api/documents/:id/blocks` and a basic upload/extracted text page. Do not send any data to AI yet.

**Acceptance:** An imported DOCX is indexed into source blocks, the original hash remains stable, and unsupported elements are explicitly identified rather than silently flattened.

# Phase 4 — Ollama-backed AI field suggestions

**Codex prompt:**

> Implement **Phase 4 only**. Create an `OllamaFieldDetector` using the official `ollama` JavaScript package with the model and endpoint configured via environment variables. Send indexed source blocks as *untrusted document data*, under an explicit instruction never to follow instructions within them. Request JSON-schema-constrained outputs and validate them with Zod; use temperature 0 or a similarly low-variance configuration if supported. AI must return candidate field metadata plus `blockId`, `quote`, and optional before/after context — never rewritten document paragraphs. Chunk long documents by source block without breaking a block; merge/deduplicate candidate keys and occurrences. Resolve model quotes against actual source text deterministically. Store unresolved/ambiguous matches for review instead of auto-applying. Add queued analysis jobs with `pending`, `running`, `done`, `failed`, durable job records and polling. On process restart mark interrupted in-flight jobs appropriately. Include timeout and actionable errors for missing Ollama/model and invalid output. Expose `POST /api/documents/:id/analyze` and `GET /api/analysis-jobs/:jobId`. Add tests with a fake Ollama client for successful extraction, hallucinated quotes, ambiguous duplicates, malicious instructions embedded in a document, malformed JSON, timeouts and offline model. Do not require Ollama for tests.

**Acceptance:** A local model suggests fields with traceable exact source quotes. It does not change the document or automatically publish templates.

# Phase 5 — Field review UI and safe template compilation

**Codex prompt:**

> Implement **Phase 5 only**. Build the template-creation UI: upload -> start AI analysis -> poll status -> review field suggestions -> manually add/edit/remove fields and their matching source occurrences -> publish. Display source blocks and exact-match highlights plus unsupported/ambiguous warnings; do not claim a pixel-perfect Word preview. Build a `MatchResolver` that resolves each approved quote/occurrence to one unique range in an indexed paragraph. Add validation for overlapping replacements, duplicate/invalid field keys, missing source blocks and stale source hashes. Build a `TemplateCompiler` that clones the original DOCX ZIP and makes targeted changes to the relevant `<w:t>` XML nodes only, inserting `[[field_key]]` placeholders. Handle matches split over multiple runs when the span is safe; maintain the prefix/suffix and original Word formatting, text spacing, and other ZIP entries. Reject unsafe crosses (e.g., paragraph/field-code boundaries) with clear messages. Never globally replace every identical string: only approved occurrences are replaced. Validate the resulting DOCX with Docxtemplater before publication. Save immutable template versions and the form schema. Add unit/integration tests with split runs, multiple occurrences, table/header/footer contexts, overlaps, names reused in unrelated prose, formatting preservation, and unchanged non-target OOXML ZIP parts. If unsupported structure prevents a safe edit, make it a reviewable failure rather than producing a damaged DOCX.

**Acceptance:** A reviewed DOCX becomes a saved, valid template; original file bytes and unrelated content stay unchanged; only explicitly selected occurrences become placeholders.

# Phase 6 — Template library, forms and document export

**Codex prompt:**

> Implement **Phase 6 only**. Build a searchable template library, template detail page, and dynamic form derived strictly from a published template's schema. Use React Hook Form plus Zod to render `text`, `date`, `number`, and `currency` controls, required/optional validation and user-friendly errors. Add `POST /api/templates/:id/render` supporting `docx` and `pdf`. Validate input on the server, reject unknown or missing fields, format date/currency/number consistently, render DOCX without Ollama, and stream the result for browser download. Add PDF conversion with locally installed LibreOffice invoked via `spawn` or `execFile` without a shell, explicit executable path, unique temporary directories/profile, timeout and cleanup. Make PDF functionality gracefully unavailable if LibreOffice is missing; DOCX generation must still work. Optionally support server-created PDF preview of an imported or generated document and show it in-browser. Avoid saving filled-in documents indefinitely. Add tests for validation, UTF-8/Cyrillic text, repeated keys, PDF conversion failure, and stable rendering with Ollama unavailable.

**Acceptance:** Select an existing template, fill a form, download DOCX or PDF. Disconnect Ollama and repeat: document generation still works.

# Phase 7 — Reliability, UX and final verification

**Codex prompt:**

> Implement **Phase 7 only**. Harden the complete local-first workflow, with no new major features. Add upload and extraction limits, strict local binding, safe filenames and storage paths, secure ZIP processing, AI output/input validation, cleanup of expired temp files, diagnostic health indicators, errors for unsupported DOCX features, and sanitized logs that never contain document text or filled-in values. Add a starter `.docx` fixture and a representative end-to-end integration test covering upload -> detect (mocked Ollama) -> review -> publish -> fill -> render -> verify DOCX output and unchanged source. Manually verify once with real Ollama and LibreOffice if available. Expand README with Mac installation, local-only network/privacy explanation, troubleshooting, limitations and a concise demo walkthrough. Run lint, typecheck, unit tests, integration tests, build, and report precise failures if a local dependency is missing.

**Acceptance:** A non-technical local user can complete the full flow and the README documents how to reproduce it from a clean machine.

---

## Manual user acceptance test

Use a source DOCX containing:

> This agreement is made between Acme Corporation and John Smith on 28 October 2026. The monthly salary is 5,000 USD. John Smith will commence employment on 1 November 2026.

Test outcomes:

1. Upload the document and inspect source text and warnings.
2. Run local analysis: it proposes employer, employee, date, salary and commencement date where sensible.
3. Review suggested fields; mark both occurrences of `John Smith` as one `employee_name` field; leave any unrelated matching text unchanged.
4. Publish a template and verify it contains `[[employee_name]]` at both approved locations.
5. Fill a dynamic form with a different employee, employer, dates and salary.
6. Export DOCX; inspect text, tables and layout. Export PDF if LibreOffice is available.
7. Disable Ollama; fill the same template again and confirm rendering succeeds offline.
8. Re-import and verify the original DOCX was never mutated.

## Important implementation pitfalls

- **Office text runs:** A single visible word may be split across many `<w:t>` nodes, even with no visible styling change. Never assume `paragraph.innerText` is a contiguous XML text node.
- **Exact scope:** The same text can appear in different places with different meaning. Each approved occurrence must be explicit; an AI model should not directly control XML writes.
- **Headers/tables:** The ZIP contains separate OOXML parts; body-only text extraction is not sufficient.
- **Preview:** LibreOffice PDF conversion may differ from Microsoft Word pagination/layout. Treat it as a useful preview, not an exact fidelity guarantee.
- **LLM behavior:** Structured output does not prove factual accuracy. Validate every proposed quote and require human approval.
- **Template syntax:** Use `[[name]]` consistently, configured with Docxtemplater's custom delimiters. Never mix it with `{{name}}` or default `{name}`.
- **Paid extensions:** The free Docxtemplater core supports simple replacements and certain loops/conditions. Plan advanced HTML/images/tables carefully; some features are commercial modules.

## Sources for implementation

- Ollama structured output: https://ollama.com/blog/structured-outputs
- Ollama Qwen 3 8B: https://ollama.com/library/qwen3:8b
- Docxtemplater Node guide: https://docxtemplater.com/docs/get-started-node/
- Docxtemplater delimiters: https://docxtemplater.com/docs/configuration/
- Docxtemplater free/paid features: https://docxtemplater.com/pricing/
- LibreOffice CLI PDF conversion: https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html
- Codex project instructions / iterative workflow: https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex
