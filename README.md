# Local AI DOCX Template Studio

A single-user web app for working with reusable DOCX templates on your computer. **Phase 1 is implemented:** workspace scaffold, local SQLite migrations, service readiness API, and dashboard. Document processing starts in later phases.

## Requirements and launch

- Node.js **22.12 or later** (a supported LTS recommended), pnpm **10.14.0**.
- Ollama and LibreOffice are optional for this phase. The application and tests work without them.

From the repository root:

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://127.0.0.1:5173**. Fastify listens on **http://127.0.0.1:3001**. Vite proxies `/api` to Fastify, so the browser uses same-origin requests without a CORS workaround. `pnpm dev` first builds the shared package, then starts both servers with file watching. Stop both with Ctrl+C. If shared contracts change, restart `pnpm dev` to rebuild them.

The API creates `data/app.sqlite`, applies committed migrations, and creates `data/storage/` on startup. Nothing needs to be seeded. Runtime data, SQLite sidecars, environment secrets, dependencies, and build artifacts are gitignored.

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
| `MAX_UPLOAD_MB` | `15`; reserved for later upload support |
| `SOFFICE_PATH` | `soffice` on PATH, or the explicit executable path in `.env.example` |

Database and storage paths resolve relative to the repository and must stay inside `data/`; existing symlink paths are rejected. Keep `.env` private. Uploaded and generated files are not implemented yet.

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

`pnpm lint` uses Biome with Tailwind-aware parsing. `pnpm test` builds shared contracts first and runs shared-schema and API tests, including mocked offline services, invalid configuration, sanitized errors, and migration persistence. Tests do not require Ollama or LibreOffice. Database tests create and remove isolated temporary databases under ignored `data/storage/`.

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

- `apps/web`: React, Vite, Tailwind CSS v4, shadcn-compatible component aliases, CSS tokens and Button; TanStack Query drives readiness. React Hook Form is installed for the later form milestone.
- `apps/api`: Fastify, Zod configuration, local readiness services, SQLite/Drizzle migrations.
- `packages/shared`: shared Zod health contract and inferred TypeScript types.

There is no cloud AI, external document service, telemetry, or remote font dependency. Readiness only contacts the configured loopback Ollama endpoint and invokes the configured local LibreOffice executable without a shell. No document contents or filled values are logged.

## Troubleshooting and scope

- API startup error: check `.env`, writable `data/`, or an occupied `API_PORT`. Invalid local-only settings fail closed with a sanitized error.
- Port 5173 already in use: stop the conflicting process; Vite uses a strict port.
- Ollama unavailable: start the local service and verify the endpoint. A running service without the selected model shows a separate model-install message.
- LibreOffice unavailable: check installation and the executable path. DOCX/PDF processing has not been implemented in Phase 1.
- Native SQLite installation fails: use a supported Node LTS and reinstall dependencies. A compiler toolchain may be needed if a prebuilt binary is unavailable. pnpm is configured to allow the required SQLite/esbuild install scripts.

Next milestone: **Phase 2 — deterministic DOCX rendering proof of concept**. No document import, AI detection, template compilation, or export is included yet.
