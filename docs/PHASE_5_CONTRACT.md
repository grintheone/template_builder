# Phase 5 approval and publication contract

Prepared 2026-10-28. This is the implementation contract for the next milestone;
the routes, persistence and compiler described here are not implemented yet.
The current quote resolver remains the foundation; do not introduce a second
matching algorithm with different text normalization or offset conventions.

## Review state and API

`PUT /api/documents/:id/fields` saves a complete review snapshot, never a partial
merge. Its strict Zod request contains `sourceHash`, `expectedRevision` (0 for
the first save), optional `analysisJobId`, `fields`, and `decisions`.

- `fields` is the human-approved selection only. Every field has a stable UUID,
  canonical snake_case `key`, label, scalar type, required flag, optional default,
  formatting metadata, and one or more approved occurrences. Reuse the existing
  shared key schema, including its reserved-name exclusions. Limit publication
  to 100 fields, matching the current renderer, and 2,000 occurrences total.
- Each occurrence has a stable UUID, `blockId`, exact `quote`, UTF-16 `start`
  and exclusive `end`, and optional provenance `{ analysisJobId, occurrenceId }`.
  Manual occurrences have no AI provenance. IDs identify records; they do not
  grant approval or establish source location. Quotes and offsets are verified
  against a fresh index of the immutable source on every save and publish.
- `decisions` records explicit accepted/rejected suggestion occurrence IDs from
  the referenced job; accepted decisions link to an approved occurrence UUID.
  Omitted suggestions remain pending. Rejecting or deleting an accepted AI
  occurrence changes its decision to rejected; removing a manual occurrence
  simply removes it. No later analysis job may overwrite these decisions.
  Changing an AI quote or location creates a manual selection and records the
  original suggestion as rejected. Renaming a field retains its identity.
- Validate provenance against a completed job for this document and source hash.
  Never accept invented suggestion IDs, duplicate IDs, invalid decision links,
  duplicate keys or conflicting definitions for a shared field. Pending or
  unresolved suggestions may remain outside the approved selection. Publication
  never promotes them implicitly. Require at least one approved field to publish.
- Defaults are optional and must match the field type: XML-safe bounded text,
  a real calendar date as `YYYY-MM-DD`, or a finite number for number/currency.
  Optional fields can omit defaults. Required values are still validated at
  rendering time; a stored default is not permission to insert `undefined`.
  Persist explicit formatting metadata: date uses `YYYY-MM-DD` initially;
  numbers/currency use a validated locale, currency uses an ISO currency code,
  and numeric precision is bounded to 0–6. Rendering logic belongs to Phase 6.
  Phase 5 must test that these metadata round-trip without model interpretation.

The response includes the saved revision and server-verified fields/decisions.
Add `GET /api/documents/:id/fields` to reload the persisted review after refresh;
this supplements the plan because review state must survive a browser restart.
Return an empty revision-0 snapshot for an existing document with no review.
Responses disable caching. Review data is sensitive and stays in local storage.

## Deterministic range validation

1. Retrieve original bytes, verify SHA-256 against both the stored source and
   request hash, validate the package in import mode, and rebuild its index.
   Do not trust client-supplied blocks, node indices, support flags or AI offsets.
2. Verify every block exists, is supported, and `text.slice(start, end) === quote`.
   Require `0 <= start < end <= text.length`; neither boundary may split a
   surrogate pair. An explicit human selection can disambiguate identical text
   within a paragraph by offset. A quote without a human-selected range must
   resolve uniquely using the existing resolver and exact adjacent context.
3. Sort ranges within each block. Reject `next.start < previous.end` across all
   fields, including identical ranges for the same key. Adjacent ranges are
   permitted. Same text in a different range or block stays untouched unless
   independently approved. No normalization, fuzzy matching or global replace.
4. Recover the original `w:t` nodes from the index. Require complete, ordered
   coverage of the range. Reject paragraph, field-code, hyperlink-container,
   bookmark/permission boundary crosses and unsupported ancestors; a supported
   paragraph alone is not sufficient proof that a multi-run span is safe.
5. Revalidate all of the above at publication, even for a saved review.

## Compiler preservation policy

Clone the original ZIP. Replace only approved text spans in editable parts.
For safe split-run matches, insert the whole placeholder into the first touched
`w:t` at the match position, remove consumed text from subsequent touched nodes,
and retain their suffixes. The placeholder inherits the first touched run's
formatting. Preserve all runs, empty text nodes, run properties and siblings;
mixed styling inside one scalar replacement cannot be retained in the value.
Display this formatting policy in review when a selection spans styled runs.

Keep prefix/suffix characters, escaping and `xml:space` semantics. An added
`xml:space="preserve"` is permitted only on an affected text node when needed;
do not discard existing attributes. Apply multiple edits in descending source
offset order, or plan every edit from original coordinates before writing.
Do not shift later ranges using already-modified text.

Prefer lexical text-node edits so untouched markup in a changed XML part does
not get reformatted by a full DOM serialization. All unmodified ZIP entry
contents must be byte-identical; the ZIP container itself may be regenerated.
Preserve images, styles, numbering, relationships, sections and table structure.
The source buffer and stored original remain byte-identical on success/failure.

Reject pre-existing `[[` or `]]` in indexed source or other text parts rather
than interpreting unapproved source text as active tags. After patching, parse
XML, validate the package, and compile with Docxtemplater's scalar-only policy
and custom delimiters. The discovered tag keys/counts must equal the approved
occurrences. Perform a trial render with bounded synthetic values, without AI.
Do not weaken the existing renderer's unsupported-structure checks to make a
document publish: if an otherwise untouched construct prevents safe subsequent
rendering, report an actionable unsupported-document failure.

## Persistence, versions and publication

Add a `document_reviews` row keyed by document ID with source hash, revision,
optional analysis job, strict snapshot JSON and timestamps. Update revision with
compare-and-swap inside a SQLite transaction. Add `templates` (one stable
identity per source document initially) and `template_versions` with immutable
version UUID, monotonic version number, review revision, source hash, compiled
file hash/private path, complete frozen form schema, and timestamp. Enforce
foreign keys and unique template/version-number and document/review-revision
publication constraints with committed Drizzle migrations.

`POST /api/documents/:id/publish` accepts only `sourceHash` and `reviewRevision`.
It compiles the saved review, never a new selection supplied to publish. The
response contains template ID, version ID/number and form schema; private paths
are never returned. Repeating publication of the same revision returns the same
version; publishing an edited review creates a new immutable version. Old
versions retain their original schema and compiled bytes. A later analysis is
never consulted when reading or rendering a saved version.

Use server-generated file paths, exclusive writes and private permissions.
Compile/validate before opening a short publication transaction. Write the new
file, then transactionally recheck review revision and insert the version.
On transaction failure remove the unpublished file; a crash may leave an orphan
but must never commit a row pointing at an unwritten file. Define startup orphan
cleanup/reconciliation without deleting referenced files or imported originals.
Concurrent publication must return the winning version for an identical revision
or a revision conflict, never overwrite a file or duplicate a version number.

## Errors and acceptance checks

Use strict shared request/response/error schemas. Invalid request shape is 400,
missing document/job is 404, source/review revision conflict is 409, and invalid
selection, unsafe span or invalid compiled template is 422. Return bounded
issue objects with codes and field/occurrence IDs; source text and private paths
must not appear in logs or error messages. Successful review responses may
contain quotes because they are displayed locally to the reviewing user.

The initial corpus is `apps/api/src/testing/compilation-corpus.ts`. Its tests
validate hand-authored expected outputs, source indexing, exact ranges,
non-target entry equality, formatting structure and rendering compatibility.
They **do not establish that a compiler exists or passes**. Phase 5 must run the
real compiler against these pairs, then add tests for:

| Case | Required result |
| --- | --- |
| Split runs, Unicode, XML escaping, leading/trailing spaces | Correct placeholder/prefix/suffix; safe boundaries; source unchanged |
| Only one of identical names selected | All unselected ranges stay unchanged |
| Table, header/footer, multiple adjacent edits | Only approved ranges change; formatting and other parts preserved |
| Overlapping/duplicate ranges; missing block; stale hash/revision | Reject without publishing or modifying source |
| Field codes, paragraph/container/bookmark crosses | Reviewable rejection |
| Existing delimiter text, malformed or extra compiled tags | Reject publication |
| Invalid/duplicate keys, forged provenance, invalid defaults | Reject review |
| Restart, resave, concurrent publish, failed write/DB commit | Decisions persist; immutable versions; no broken committed references |
| UI polling, manual add/edit/remove, ambiguity correction | Explicit approval only; reload restores review; failures retain edits |

Use focused frontend tests for these stateful review flows; the current frontend
has no automated tests. Keep the tagged-DOCX demo separate from publication.
No library, production render endpoint or PDF conversion is part of this prep.
