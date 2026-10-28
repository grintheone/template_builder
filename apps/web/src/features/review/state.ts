import type { AnalysisJob, ReviewedField, ReviewSnapshot, ResolvedOccurrence } from '@studio/shared';
export function formatting(type: ReviewedField['type']): ReviewedField['formatting'] {
  return type === 'date' ? { dateFormat: 'YYYY-MM-DD' } : type === 'number' ? { locale: 'en-US', precision: 2 } : type === 'currency' ? { locale: 'en-US', currency: 'USD', precision: 2 } : {};
}
export function removeOccurrence(review: ReviewSnapshot, id: string): ReviewSnapshot {
  const occurrence = review.fields.flatMap((f) => f.occurrences).find((o) => o.id === id);
  return { ...review, fields: review.fields.map((f) => ({ ...f, occurrences: f.occurrences.filter((o) => o.id !== id) })).filter((f) => f.occurrences.length),
    decisions: occurrence?.provenance ? [...review.decisions.filter((d) => d.occurrenceId !== occurrence.provenance?.occurrenceId), { occurrenceId: occurrence.provenance.occurrenceId, status: 'rejected' }] : review.decisions };
}
export function approveSuggestion(review: ReviewSnapshot, job: AnalysisJob, field: NonNullable<AnalysisJob['result']>['fields'][number], occurrence: ResolvedOccurrence): ReviewSnapshot {
  if (occurrence.status !== 'resolved' || occurrence.start === undefined || occurrence.end === undefined || review.decisions.some((d) => d.occurrenceId === occurrence.id)) throw new Error('Choose an unresolved decision with an exact source range.');
  const previous = review.fields.find((f) => f.key === field.key);
  if (previous && (previous.type !== field.type || previous.required !== field.required || previous.label !== field.label)) throw new Error('This key has different metadata. Add the occurrence manually to the intended field.');
  const approved = { id: crypto.randomUUID(), blockId: occurrence.blockId, quote: occurrence.quote, start: occurrence.start, end: occurrence.end, provenance: { analysisJobId: job.jobId, occurrenceId: occurrence.id } };
  return { ...review, analysisJobId: job.jobId,
    fields: previous ? review.fields.map((f) => f.id === previous.id ? { ...f, occurrences: [...f.occurrences, approved] } : f) : [...review.fields, { id: crypto.randomUUID(), key: field.key, label: field.label, type: field.type, required: field.required, formatting: formatting(field.type), occurrences: [approved] }],
    decisions: [...review.decisions, { occurrenceId: occurrence.id, status: 'accepted', approvedOccurrenceId: approved.id }] };
}
