# Phase 2 — deterministic DOCX rendering proof of concept

Completed and verified on 28 October 2026. Phase 3 has not been started.

## Implementation

`DocxRenderer.render(source: Buffer, values: unknown): Promise<Buffer>` validates a tagged DOCX and scalar values, compiles using Docxtemplater with `[[` / `]]` delimiters, and returns a new DOCX buffer. Every distinct supported tag is required; unknown keys, missing values, invalid value types, malformed tags, loops, expressions and raw-XML substitution are rejected. Explicit blanks and finite numbers (including zero) are supported. Values are inserted as escaped text. No AI or external service participates in rendering.

The renderer inspects Docxtemplater's parsed placeholders through its module inspection hook rather than searching raw XML for contiguous tags. It therefore supports Word splitting tags across runs. Only body/table/header/footer parts containing placeholders are copied from the rendered archive into a fresh original archive; every other ZIP part retains its original uncompressed bytes. Repeated rendering does not mutate source input bytes.

`POST /api/dev/render` accepts multipart `template` (one .docx) and `values` (JSON), in either order, and returns a fixed-name DOCX attachment. This development endpoint intentionally differs from the future saved-template render endpoint: there is no imported-document record, template publication, or durable upload in this phase. The UI uses React Hook Form to choose a tagged file, edit sample JSON, and download the result.

Package validation uses lazy yauzl entry reading and bounded streaming before PizZip rendering. It checks ZIP signature, size, entry count, paths, encryption, compression methods, symlinks, a conservative OPC part allowlist, required main parts, well-formed XML, and unsupported document structures. No ZIP paths are used for filesystem writes. Uploaded/generated buffers stay in memory. Known request errors return sanitized JSON; library error logging is disabled.

## Files added

- `packages/shared/src/schemas/render.ts`
- `packages/shared/src/schemas/render.test.ts`
- `apps/api/src/services/docx/errors.ts`
- `apps/api/src/services/docx/validate-package.ts`
- `apps/api/src/services/docx/renderer.ts`
- `apps/api/src/services/docx/renderer.test.ts`
- `apps/api/src/routes/dev-render.ts`
- `apps/api/src/routes/dev-render.test.ts`
- `apps/api/src/testing/docx-fixture.ts`
- `apps/api/src/testing/create-demo.ts`
- `apps/web/src/features/render/RenderDemo.tsx`
- `PHASE_2_REPORT.md`

## Files modified

- `packages/shared/src/index.ts`: export rendering contracts.
- `apps/api/src/app.ts`: register bounded multipart and render route; sanitize expected errors; round configured upload bytes to a positive integer.
- `apps/api/package.json`, `pnpm-lock.yaml`: add Docxtemplater, PizZip, xmldom, Fastify multipart, yauzl/types, and fixture command.
- `package.json`: root `demo:fixture` command.
- `apps/web/src/App.tsx`: replace the Phase 1 placeholder panel with the rendering demo.
- `README.md`: current scope, launch/demo/API commands, limits and limitations.

Existing Phase 1 files and instructions were preserved. This repository still has no initial commit, so Git shows both pre-existing scaffold files and Phase 2 files as untracked; the lists above identify this milestone's changes. No commits or pushes were made.

## Verification and commands

| Check | Result |
| --- | --- |
| Dependency API inspection | Installed Docxtemplater parser/module hooks, PizZip options, xmldom error handling, Fastify multipart streaming/limits, yauzl streaming validation/types inspected |
| `pnpm install --frozen-lockfile` | Passed, no resolution changes |
| `pnpm lint` | Passed, 54 files checked |
| `pnpm typecheck` | Passed for all workspaces |
| `pnpm test` | Passed, 78 tests across eight test files (61 API, 17 shared) |
| `pnpm build` | Passed for shared, API, web |
| `pnpm demo:fixture` | Passed; generated ignored data/storage/demo-tagged.docx |
| Live render through Vite proxy | Passed; multipart request to port 5173 produced data/storage/demo-rendered.docx |
| Browser upload/download | Passed using the generated fixture and sample JSON; rendered.docx downloaded, success status displayed, no captured console warnings/errors |
| LibreOffice acceptance | Generated DOCX opened as a Writer document via headless conversion using a separate local profile; one-page QA PDF rendered to PNG and inspected |
| Built API with optional services offline | Passed; API started on 127.0.0.1:3101, health returned 200 with optional dependencies unavailable, render returned a valid DOCX |
| Normal vs offline render | All ZIP part contents matched; archives passed CRC validation |

Automated coverage includes body paragraphs, split runs, table cells, headers/footers, repeated tags, Cyrillic/CJK/emoji/XML escaping, explicit blanks, zero/negative numbers, multiline values, missing/unknown keys, rejected non-scalar values and XML controls, malformed/special tags, source SHA-256 stability, independent repeated renders, preserved formatting markers and non-target ZIP parts, corrupt/missing/unsafe ZIP/XML parts, encryption, expansion limits, output amplification, multipart order and limits, malformed requests, and sanitized errors. Phase 1 offline health, configuration and migration tests remain green. Frontend behavior was checked in-browser; this scaffold still has no automated component tests.

Representative commands executed beyond the standard checks:

```sh
pnpm --filter @studio/api add docxtemplater@^3.71.1 pizzip@^3.3.0 @xmldom/xmldom@^0.9.12 @fastify/multipart@^10.1.6
pnpm --filter @studio/api add yauzl@^3.2.0
pnpm --filter @studio/api add -D @types/yauzl@^2.10.3
pnpm demo:fixture
curl -fsS -F 'values={"client_name":"Иван Smith","amount":1250.5}' -F 'template=@data/storage/demo-tagged.docx' http://127.0.0.1:5173/api/dev/render -o data/storage/demo-rendered.docx
API_PORT=3101 OLLAMA_BASE_URL=http://127.0.0.1:1 SOFFICE_PATH=/nonexistent/studio-soffice pnpm start
curl -fsS http://127.0.0.1:3101/api/health
curl -fsS -F 'values={"client_name":"Иван Smith","amount":1250.5}' -F 'template=@data/storage/demo-tagged.docx' http://127.0.0.1:3101/api/dev/render -o data/storage/demo-offline.docx
pdftoppm -r 100 -png -singlefile data/storage/phase2-qa/demo-rendered.pdf data/storage/phase2-qa/verified-page
```

LibreOffice was invoked only for QA using Node `execFile` with an argument array, `shell: false`, a 45-second timeout and a separate `-env:UserInstallation=file://.../data/storage/phase2-qa/lo-profile` profile. This is not an application PDF export implementation. The temporary built API on port 3101 was stopped. Existing development servers remain available on ports 3001/5173.

## Issues encountered

- The first malformed-delimiter fixture included unescaped less-than signs, making its XML invalid before template parsing. The fixture paragraph helper now escapes XML text, and the template-error test passes.
- A fractional upload setting exposed Fastify's integer-byte requirement. The app now rounds the computed byte limit to a positive integer; the oversized-file test passes.
- Native LibreOffice UI automation could not proceed while macOS Accessibility/Screen Recording permissions were pending. Headless LibreOffice successfully opened the output instead; no GUI verification claim is made.
- CJK glyph appearance in the local LibreOffice PDF was incomplete, even after specifying an installed CJK-capable font. The same CJK display limitation was visible in the original tagged fixture before rendering. The DOCX XML retains the exact Unicode text, verified in tests. Rendering appearance depends on local Office/fonts; Latin and Cyrillic text, title formatting, table, numbering, header and footer were visually verified. Microsoft Word was not available for verification.
- `pdftotext` and Python `fontTools` were unavailable. Bundled `pdftoppm` and `pypdf` supported the QA inspection instead. No additional system packages were installed.
- Dependency installation reports existing deprecated transitive packages from Drizzle/native SQLite tooling. Installation and all checks pass.

## Launch and try

```sh
pnpm install
pnpm dev
# In another terminal:
pnpm demo:fixture
```

Open http://127.0.0.1:5173, choose data/storage/demo-tagged.docx in Try a tagged DOCX, keep or edit the sample JSON, and click Render and download DOCX. Open the result in Word/LibreOffice. The fixture command uses configured STORAGE_DIR if changed.

## Remaining limits and next milestone

This proof of concept accepts standard, well-formed UTF-8 DOCX packages and scalar fields only. The conservative package/structure allowlist rejects custom XML, charts, embedded objects, signed packages, tracked edits, text boxes and field-code documents. Tags in unsupported text parts are rejected. Values are text/finite numbers with no automatic date/currency/locale formatting. Limits are documented in README, including conservative output-expansion rejection.

There is no durable document import, OOXML indexing, AI analysis, template compilation/publication, template library, published-schema dynamic form, or app PDF export. The next milestone is Phase 3 — secure DOCX import and source indexing; it has not been started.
