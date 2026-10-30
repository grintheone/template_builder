# Phase 7 verification — 30 October 2026

Implemented reliability hardening within the existing workflow; no new major
product features or schema migrations.

## Changes

- `apps/api/src/local-access.ts`, `app.ts`: check loopback Host headers, reject
  remote/null Origin and cross-site browser requests before body parsing, set
  no-store/nosniff headers consistently, and bound request/connection duration.
  Existing configuration still rejects non-loopback server/Ollama settings.
- `services/docx/validate-package.ts`: validate ZIP checksums only after bounded
  streaming size checks; bound XML nesting/elements before DOM allocation.
  Existing extension/OPC allowlist, encryption, traversal, upload/expansion and
  paragraph limits remain enforced, with sanitized errors.
- `storage/temporary.ts`, PDF converter and template routes: remove expired
  converter directories at startup and before subsequent PDF exports. Keep
  recent work, symlinks and unrelated/private permanent data. Normal conversion
  cleanup still runs on success, failure and timeout.
- `testing/starter-fixture.ts`, `create-demo.ts`: generate a populated employment
  agreement suitable for importing, alongside the existing tagged demo.
- New failure tests exercise local browser access, ZIP checksum/DTD/XML limits,
  and temporary-directory expiry. The complete workflow integration test uses
  the production detector/resolver with a mocked Ollama chat client, explicit
  approval/rejection and all four field types. It restarts before rendering with
  an offline detector and compares original bytes/hash and untouched ZIP parts.
- `testing/smoke-workflow.ts` and package scripts add an opt-in synthetic live
  service check, isolated from ordinary offline tests and real user data.
- README adds macOS installation, demo, privacy/retention, limits,
  troubleshooting and verification commands.

## Automated checks

All passed on Node.js 22.12.0 / pnpm 10.14.0:

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed in all three workspace packages |
| `pnpm test` | 181 tests passed: 33 shared, 141 API, 7 web; 26 test files |
| `pnpm build` | Shared/API TypeScript and Vite production builds passed |
| `git diff --check` | Passed |

`pnpm test` includes unit, Fastify API integration, and React interaction tests.
It requires neither Ollama nor LibreOffice. There is no separate browser end-to-end
test runner.

## Real local services

`pnpm smoke:workflow` passed with local `qwen3:8b` and LibreOffice 26.8.1.1.
It uploaded the synthetic source through Fastify, completed a real queued AI job
(six suggested fields), explicitly entered six known scalar field definitions,
published, restarted with an offline detector, and exported DOCX and PDF. Rendering
made zero detector calls; the original bytes and SHA-256 remained unchanged.

The smoke check deliberately rejects model candidates and uses explicit known
review choices. This verifies the manual correction path, not semantic accuracy
of AI proposals or automatic approval. The generated DOCX text was verified by
indexing. The generated one-page PDF was rendered with Poppler and visually
inspected: header/footer, Cyrillic employee name, bold replacement, salary and
hours appeared legibly without clipping; unrelated author text remained intact.

Synthetic artifacts and the count-only report are retained locally under
`data/storage/workflow-smoke-5gwets/`, ignored by Git. The live check initially
hit the sandbox's TypeScript-runner IPC socket restriction and was rerun with
approved permissions. No optional local dependency was missing.

## Limits and next step

The live check used API injection and visual PDF inspection; a complete manual
browser/Word walkthrough was not performed. Existing React interaction tests
cover review/forms. Use the README walkthrough for user acceptance on representative
real documents, including inspection in the user's Word/LibreOffice installation.

AI suggestions still need human review. Unsupported OOXML remains explicitly
restricted, PDF pagination may differ from Word, and the UI presents extracted
text rather than Word-native layout. Storage is local/private but unencrypted;
originals, review/default data and published versions are retained. Synthetic
smoke artifacts are intentionally retained; ordinary rendered exports are not.

The seven planned phases are implemented. Next is user acceptance; further
features need a separately scoped milestone.
