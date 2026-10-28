# Local AI DOCX Template Studio

A single-user web app for working with reusable DOCX templates on your computer. **Phases 1 and 2 are implemented:** local services and a deterministic rendering proof of concept for DOCX files that already contain `[[snake_case]]` tags.

## Requirements and launch

- Node.js **22.12 or later** (a supported LTS recommended), pnpm **10.14.0**.
- Ollama and LibreOffice are optional for these phases. DOCX rendering and automated tests work without them.

From the repository root:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://127.0.0.1:5173**. Fastify listens on **http://127.0.0.1:3001**. Vite proxies `/api` to Fastify, so the browser uses same-origin requests without a CORS workaround. `pnpm dev` first builds the shared package, then starts both servers with file watching. Stop both with Ctrl+C. If shared contracts change, restart `pnpm dev` to rebuild them.

The API creates `data/app.sqlite`, applies committed migrations, and creates `data/storage/` on startup. Nothing needs to be seeded. Runtime data, SQLite sidecars, environment secrets, dependencies, and build artifacts are gitignored.

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
| `OLLAMA_MODEL` | `qwen3:8b` |
| `DATABASE_PATH` | `./data/app.sqlite` |
| `STORAGE_DIR` | `./data/storage` |
| `MAX_UPLOAD_MB` | `15`; maximum tagged DOCX upload size in MiB |
| `SOFFICE_PATH` | `soffice` on PATH, or the explicit executable path in `.env.example` |

Database and storage paths resolve relative to the repository and must stay inside `data/`; existing symlink paths are rejected. Keep `.env` private. The rendering route processes uploads and results in memory without saving them. The demo-fixture command explicitly writes its sample under `data/storage/`. Browser downloads go to your browser's configured download location.

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

`pnpm lint` uses Biome with Tailwind-aware parsing. `pnpm test` builds shared contracts first and runs shared-schema and API tests, including mocked offline services, invalid configuration, sanitized errors, migration persistence, generated DOCX fixtures, rendering/formatting preservation, and multipart failure cases. Tests do not require Ollama or LibreOffice. Database tests create and remove isolated temporary databases under ignored `data/storage/`.

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

- `apps/web`: React, Vite, Tailwind CSS v4, shadcn-compatible component aliases, CSS tokens and Button; TanStack Query drives readiness. React Hook Form validates the tagged-DOCX rendering demo; published-template forms are a later milestone.
- `apps/api`: Fastify, bounded multipart uploads, DOCX package validation, Docxtemplater/PizZip renderer, local readiness services, and SQLite/Drizzle migrations.
- `packages/shared`: shared Zod health, render-value and error contracts with inferred TypeScript types.

There is no cloud AI, external document service, telemetry, or remote font dependency. Readiness only contacts the configured loopback Ollama endpoint and invokes the configured local LibreOffice executable without a shell. No document contents or filled values are logged.

## Troubleshooting and scope

- API startup error: check `.env`, writable `data/`, or an occupied `API_PORT`. Invalid local-only settings fail closed with a sanitized error.
- Port 5173 already in use: stop the conflicting process; Vite uses a strict port.
- Ollama unavailable: start the local service and verify the endpoint. A running service without the selected model shows a separate model-install message.
- LibreOffice unavailable: check installation and the executable path. DOCX rendering still works without it. PDF export is a later milestone.
- Native SQLite installation fails: use a supported Node LTS and reinstall dependencies. A compiler toolchain may be needed if a prebuilt binary is unavailable. pnpm is configured to allow the required SQLite/esbuild install scripts.

Next milestone: **Phase 3 — DOCX import and source indexing**. Immutable document storage, indexing, AI detection, template compilation, library forms and PDF export have not been implemented.
