import { randomUUID } from 'node:crypto';
import type { SourceBlock, SuggestedOccurrence, ResolvedOccurrence } from '@studio/shared';

// Exact UTF-16 offsets into the immutable index; no normalization or global replacement.
export function resolveOccurrence(occurrence: SuggestedOccurrence, blocks: Map<string, SourceBlock>): ResolvedOccurrence {
  const base = { ...occurrence, id: randomUUID() };
  const unresolved = (reason: NonNullable<ResolvedOccurrence['reason']>): ResolvedOccurrence => ({ ...base, status: 'unresolved', reason });
  const block = blocks.get(occurrence.blockId);
  if (!block) return unresolved('missing_block');
  if (!block.supported) return unresolved('unsupported_block');
  let found = false;
  let match: number | undefined;
  for (let offset = block.text.indexOf(occurrence.quote); offset !== -1; offset = block.text.indexOf(occurrence.quote, offset + 1)) {
    found = true;
    const end = offset + occurrence.quote.length;
    if (occurrence.contextBefore !== undefined && !block.text.slice(0, offset).endsWith(occurrence.contextBefore)) continue;
    if (occurrence.contextAfter !== undefined && !block.text.slice(end).startsWith(occurrence.contextAfter)) continue;
    if (match !== undefined) return unresolved('ambiguous');
    match = offset;
  }
  if (match === undefined) return unresolved(found ? 'context_mismatch' : 'quote_not_found');
  return { ...base, status: 'resolved', start: match, end: match + occurrence.quote.length };
}
