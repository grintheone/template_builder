# Preparation before Phase 5

Completed 2026-10-28. Phase 5 implementation has not started.

## Baseline and scope

The working tree was clean at the start. Existing lint, typecheck, 130 tests and
production builds passed. No broad refactor or dependency upgrade was needed.
Preparation adds an opt-in live detector smoke command, a written approval and
publication contract, and a generated preservation corpus. No production routes,
database migrations, UI flows, compiler or publication behavior are added.

## Live local model findings

Two runs used the installed `qwen3:8b` model (Q4_K_M, model digest
`500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`)
through the production detector and its configured loopback endpoint. Each run
used three generated, populated DOCX packages, not existing private originals.
They are genuine OPC/OOXML packages but do not replace testing documents saved
by Word/LibreOffice or checking visual layout in those applications.

The second run completed with the default 120-second deadline per sample:

| Sample | Fields | Resolved / unresolved | Exact expected selections found | Duration |
| --- | --- | --- | --- | --- |
| Split runs and an unrelated repeated name | 1 | 0 / 1 | 0 / 1 | 5.3 s |
| Table amount, header name, footer date | 3 | 2 / 1 | 0 / 3 | 14.5 s |
| Unicode, repeated names and embedded instructions | 3 | 3 / 0 | 0 / 1 | 13.6 s |

All five resolved occurrences were traceable to exact source text. Both
unresolved occurrences had mismatched adjacent context and remained unresolved.
All three source buffers retained their hashes. Neither the detector nor this
command modifies or publishes documents. The first run had the same counts and
zero exact expected selections, taking approximately 11–16 seconds per sample.

Local inspection of the second run's saved synthetic suggestions found that
the model selected whole paragraphs, including labels, instead of the intended
scalar values. It also proposed static header/footer text as fields. This is a
semantic-quality failure despite valid schema output and exact source matching.
The embedded instruction paragraph was not proposed as a field, and the result
passed the strict output schema; this limited observation is not a guarantee
of prompt-injection resistance.

**Decision:** proceed to Phase 5 only with manual editing/addition/removal as a
core workflow. Exact matching cannot establish whether a proposed field is
useful. Do not preapprove suggestions or weaken context matching. A later focused
Phase 4 prompt evaluation should compare scalar-only examples and explicit
exclusion of labels/static headings against this corpus before changing prompts
or models. The current model is not reliable enough for unattended detection.

The second run's ignored local artifacts are under
`data/storage/readiness-1735838b-5787-4f7e-8777-4714b6950c5c/`:
three source DOCX files, private synthetic `*.analysis.json` suggestions, and
`report.json`. No source text, quotes, labels or generated field keys are logged;
console/report summaries contain counts, hashes and bounded reason codes.
These artifacts are not committed or loaded into the application's document DB.

Repeat explicitly with `pnpm smoke:analysis` after starting Ollama and installing
the configured model. Each invocation creates a new private ignored directory.
The command does not download models, launch services or use external AI. It
honors the regular endpoint/model/deadline configuration and fails for transport,
schema or traceability errors. `safetyStatus: passed` does **not** mean good
suggestions: inspect `detectionQuality` and exact expected-location counts too.
Exact expected-location counts deliberately require the intended quote and
range; larger quotes containing the value do not count as correct selections.

## Approval contract and preservation foundation

[PHASE_5_CONTRACT.md](PHASE_5_CONTRACT.md) defines strict review snapshots,
suggestion decisions/provenance, manual exact ranges, server revalidation,
concurrency, source hashes, immutable versions, safe write ordering and errors.
It also records decisions needed for split-run formatting, existing delimiter
text and unsupported documents, so implementation need not guess these later.

`apps/api/src/testing/compilation-corpus.ts` provides independent source and
hand-authored expected tagged packages. Four new tests verify fixture integrity,
split-run coverage, exact occurrence selection, unrelated repeated text,
table/header/footer contexts, Unicode/XML escaping/spacing, run-property and
structure preservation, non-target entry byte equality, and compatibility with
the existing renderer. Ambiguous text and a field-code boundary remain unresolved.

These are acceptance fixtures and checks of existing indexing/resolution/rendering,
**not tests of a working compiler**. Phase 5 must pass real compiler output
through the same checks and add the contract's failure matrix, including overlaps,
stale hashes/revisions, unsafe boundaries, concurrency and failed publication.
Visual inspection in Word/LibreOffice and stateful frontend tests remain needed.

## Verification and next milestone

Lint, typecheck, all 134 tests (29 shared, 105 API) and builds pass. The frontend
still has no automated tests. Live model calls are opt-in and excluded from the
offline test suite. The sandbox blocked local network/tsx startup, so the live
checks ran with approved execution outside the sandbox.

Next: Phase 5, beginning with review schemas/persistence and real compiler tests
against this corpus, followed by compiler implementation and the review UI.
