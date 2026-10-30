import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { analysisJobSchema, analysisStartedSchema, reviewSnapshotSchema, saveReviewSchema, publishedVersionSchema, type ReviewSnapshot, type SourceBlock, type ReviewedField, type PublishedVersion } from '@studio/shared';
import { Button } from '@/components/ui/button';
import { approveSuggestion, formatting, removeOccurrence } from './state';

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'The local service could not complete the request.');
  return data;
}
const inputClass = 'w-full rounded border border-border bg-white p-2 text-sm';
export function ReviewStudio({ documentId, sourceHash, blocks }: { documentId: string; sourceHash: string; blocks: SourceBlock[] }) {
  const saved = useQuery({ queryKey: ['review', documentId], retry: false, queryFn: async () => reviewSnapshotSchema.parse(await api(`/api/documents/${documentId}/fields`)) });
  return <div className="mt-6">
    {saved.isPending && <p>Loading saved review…</p>}
    {saved.error && <p role="alert">{saved.error.message}</p>}
    {saved.data && <ReviewEditor initial={saved.data} sourceHash={sourceHash} blocks={blocks} />}
  </div>;
}
function ReviewEditor({ initial, sourceHash, blocks }: { initial: ReviewSnapshot; sourceHash: string; blocks: SourceBlock[] }) {
  const queryClient = useQueryClient();
  const [review, setReview] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [jobId, setJobId] = useState(initial.analysisJobId);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState<PublishedVersion>();
  const [correction, setCorrection] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const manual = useForm<{ blockId: string; start: number; end: number; target: string; key: string }>({ defaultValues: { blockId: blocks.find((b) => b.supported)?.id ?? '', start: 0, end: 0, target: '', key: '' } });
  const blockId = manual.watch('blockId'); const start = Number(manual.watch('start')); const end = Number(manual.watch('end'));
  const selected = blocks.find((b) => b.id === blockId);
  const update = (next: ReviewSnapshot) => { setReview(next); setDirty(true); setVersion(undefined); setMessage(''); };
  const startAnalysis = useMutation({ mutationFn: async () => analysisStartedSchema.parse(await api(`/api/documents/${review.documentId}/analyze`, 'POST')),
    onSuccess: (data) => { setJobId(data.jobId); setMessage(''); } });
  const job = useQuery({ queryKey: ['analysis-job', jobId], enabled: !!jobId, retry: false,
    queryFn: async () => analysisJobSchema.parse(await api(`/api/analysis-jobs/${jobId}`)),
    refetchInterval: (query) => query.state.error || query.state.data && ['done', 'failed'].includes(query.state.data.status) ? false : 1000,
  });
  // Keep the current job address in the URL so polling can resume after refresh.
  useEffect(() => { if (jobId) { const url = new URL(window.location.href); url.searchParams.set('job', jobId); window.history.replaceState(null, '', url); } }, [jobId]);
  useEffect(() => { const resume = new URL(window.location.href).searchParams.get('job'); if (!jobId && resume && /^[a-f0-9-]{36}$/.test(resume)) setJobId(resume); }, [jobId]);
  const jobMatches = job.data?.documentId === review.documentId && job.data.sourceHash === sourceHash;
  const persist = async (publish: boolean) => {
    setBusy(true); setMessage('');
    try {
      if (publish) {
        const result = publishedVersionSchema.parse(await api(`/api/documents/${review.documentId}/publish`, 'POST', { sourceHash, reviewRevision: review.revision }));
        setVersion(result);
        void queryClient.invalidateQueries({ queryKey: ['templates'] });
        void queryClient.invalidateQueries({ queryKey: ['template', result.templateId] });
      } else {
        const { documentId: _id, revision, ...selection } = review;
        const input = saveReviewSchema.safeParse({ ...selection, expectedRevision: revision });
        if (!input.success) throw new Error('Check field keys, defaults, formatting, duplicate IDs and selected ranges before saving.');
        const snapshot = reviewSnapshotSchema.parse(await api(`/api/documents/${review.documentId}/fields`, 'PUT', input.data));
        setReview(snapshot); setDirty(false); setMessage('Review saved.');
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'The review could not be saved.'); }
    finally { setBusy(false); }
  };
  const editField = (id: string, patch: Partial<ReviewedField>) => update({ ...review, fields: review.fields.map((f) => f.id === id ? { ...f, ...patch } : f) });
  const correct = (id: string) => {
    setCorrection(undefined);
    const field = review.fields.find((f) => f.occurrences.some((o) => o.id === id)); const o = field?.occurrences.find((o) => o.id === id);
    if (field && o) { manual.reset({ blockId: o.blockId, start: o.start, end: o.end, target: field.id, key: field.key }); setEditing(id); }
  };
  return <section className="space-y-6" aria-label="Field review">
    <div className="rounded-lg bg-muted p-4 text-sm"><h3 className="font-semibold">Review and publish</h3><p className="mt-2">Only explicitly approved occurrences become fields. Text view highlights show exact source ranges, not Word page layout. Replacements spanning runs inherit the first run’s formatting; mixed styling within the replaced value is lost.</p>
      <Button className="mt-3" disabled={busy || startAnalysis.isPending || !!review.analysisJobId || !!jobId && (!job.data || ['pending', 'running'].includes(job.data.status))} onClick={() => startAnalysis.mutate()}>Start local AI analysis</Button>
      <p className="mt-2">You can also select fields manually without AI. Once saved, suggestion decisions remain tied to their analysis job. Saved revision: {review.revision}{dirty ? ' · Unsaved edits' : ''}</p>
      {(startAnalysis.error || job.error) && <p role="alert">{(startAnalysis.error || job.error)?.message}</p>}
      {job.data && <p role="status">Analysis: {job.data.status}{job.data.error ? ` — ${job.data.error.message}` : ''}</p>}
    </div>
    {job.data?.result && jobMatches && <section aria-label="Suggestions" className="space-y-3"><h3 className="font-semibold">Suggestions — none are approved automatically</h3>
      {job.data.result.warnings.map((w) => <p className="text-sm text-amber-900" key={w}>{w}</p>)}
      {job.data.result.fields.flatMap((field) => field.occurrences.map((o) => {
        const decision = review.decisions.find((d) => d.occurrenceId === o.id);
        return <article className="rounded border border-border p-3 text-sm" key={o.id}><p>{field.label} · {field.key} · {field.type} · {Math.round(field.confidence * 100)}%</p><p className="whitespace-pre-wrap">“{o.quote}”</p><p className="break-all text-xs">{o.blockId} · {o.status === 'resolved' ? `range ${o.start}–${o.end}` : `Needs correction: ${o.reason}`}</p>
          <div className="mt-2 flex gap-2"><Button disabled={busy || !!decision || o.status !== 'resolved'} onClick={() => { try { update(approveSuggestion(review, analysisJobSchema.parse(job.data), field, o)); } catch (e) { setMessage((e as Error).message); } }}>Approve occurrence</Button>
          <Button variant="outline" disabled={busy || !!decision} onClick={() => update({ ...review, analysisJobId: job.data?.jobId, decisions: [...review.decisions, { occurrenceId: o.id, status: 'rejected' }] })}>Reject</Button>
          {o.status === 'unresolved' && <Button variant="outline" disabled={busy || !!decision} onClick={() => { setEditing(undefined); setCorrection(o.id); manual.setValue('target', review.fields.find((f) => f.key === field.key)?.id ?? ''); manual.setValue('blockId', o.blockId); manual.setValue('key', field.key); manual.setValue('start', 0); manual.setValue('end', 0); setMessage('Select the exact range below. Adding it records the original suggestion as rejected.'); }}>Correct manually</Button>}
          {decision && <span>{decision.status}</span>}</div>
        </article>;
      }))}
    </section>}
    <section aria-label="Approved fields" className="space-y-4"><h3 className="font-semibold">Approved fields ({review.fields.length})</h3>{!review.fields.length && <p className="text-sm">No occurrences approved yet.</p>}
      <fieldset disabled={busy} className="space-y-4">{review.fields.map((f) => <article key={f.id} className="space-y-3 rounded border border-border p-4">
        <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Field key<input aria-label={`Key ${f.key}`} className={inputClass} value={f.key} onChange={(e) => editField(f.id, { key: e.target.value })} /></label>
        <label className="text-sm">Label<input className={inputClass} value={f.label} onChange={(e) => editField(f.id, { label: e.target.value })} /></label>
        <label className="text-sm">Type<select className={inputClass} value={f.type} onChange={(e) => { const type = e.target.value as ReviewedField['type']; editField(f.id, { type, formatting: formatting(type), default: undefined }); }}>{['text', 'date', 'number', 'currency'].map((t) => <option key={t}>{t}</option>)}</select></label></div>
        <label className="mr-5 text-sm"><input type="checkbox" checked={f.required} onChange={(e) => editField(f.id, { required: e.target.checked })} /> Required</label>
        <label className="inline-block text-sm">Default (optional)<input className={inputClass} type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'} step="any" value={f.default ?? ''} onChange={(e) => editField(f.id, { default: e.target.value === '' ? undefined : ['number', 'currency'].includes(f.type) ? Number(e.target.value) : e.target.value })} /></label>
        {['number', 'currency'].includes(f.type) && <div className="flex flex-wrap gap-3"><label className="text-sm">Locale<input className={inputClass} value={f.formatting.locale ?? ''} onChange={(e) => editField(f.id, { formatting: { ...f.formatting, locale: e.target.value } })} /></label><label className="text-sm">Precision<input className={inputClass} type="number" min="0" max="6" value={f.formatting.precision ?? 2} onChange={(e) => editField(f.id, { formatting: { ...f.formatting, precision: Number(e.target.value) } })} /></label>{f.type === 'currency' && <label className="text-sm">Currency<input className={inputClass} value={f.formatting.currency ?? ''} onChange={(e) => editField(f.id, { formatting: { ...f.formatting, currency: e.target.value } })} /></label>}</div>}
        {f.type === 'date' && <p className="text-xs">Date format: YYYY-MM-DD</p>}
        {f.occurrences.map((o) => <div key={o.id} className="rounded bg-muted p-3 text-sm"><p className="whitespace-pre-wrap">“{o.quote}”</p><p className="break-all text-xs">{o.blockId} · {o.start}–{o.end}{o.provenance ? ' · AI provenance' : ' · Manual'}</p><div className="mt-2 flex gap-2"><Button variant="outline" onClick={() => correct(o.id)}>Edit range</Button><Button variant="outline" onClick={() => update(removeOccurrence(review, o.id))}>Remove occurrence</Button></div></div>)}
        <Button variant="outline" onClick={() => { let next = review; for (const o of f.occurrences) next = removeOccurrence(next, o.id); update(next); }}>Remove field</Button>
      </article>)}</fieldset>
    </section>
    <form aria-label="Manual occurrence" className="space-y-3 rounded border border-border p-4" onSubmit={manual.handleSubmit((values) => {
      if (!selected?.supported || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > selected.text.length) { setMessage('Choose a supported paragraph and a non-empty exact range.'); return; }
      if (editing && !review.fields.some((f) => f.occurrences.some((o) => o.id === editing))) { setEditing(undefined); setMessage('That occurrence was removed. Select a new range.'); return; }
      let next = editing ? removeOccurrence(review, editing) : review;
      const occurrence = { id: crypto.randomUUID(), blockId, start, end, quote: selected.text.slice(start, end) };
      const originalField = review.fields.find((f) => f.id === values.target);
      const target = next.fields.find((f) => f.id === values.target);
      if (target) next = { ...next, fields: next.fields.map((f) => f.id === target.id ? { ...f, occurrences: [...f.occurrences, occurrence] } : f) };
      else next = { ...next, fields: [...next.fields, originalField ? { ...originalField, occurrences: [occurrence] } : { id: crypto.randomUUID(), key: values.key, label: values.key, type: 'text', required: true, formatting: {}, occurrences: [occurrence] }] };
      if (correction && job.data) next = { ...next, analysisJobId: job.data.jobId, decisions: [...next.decisions.filter((d) => d.occurrenceId !== correction), { occurrenceId: correction, status: 'rejected' }] };
      update(next); setEditing(undefined); setCorrection(undefined);
    })}>
      <h3 className="font-semibold">{editing ? 'Edit exact range' : 'Add a manual occurrence'}</h3>
      <fieldset disabled={busy} className="space-y-3"><label className="block text-sm">Source paragraph<select className={inputClass} {...manual.register('blockId')} onChange={(e) => { manual.setValue('blockId', e.target.value); manual.setValue('start', 0); manual.setValue('end', 0); }}>{blocks.map((b) => <option key={b.id} value={b.id} disabled={!b.supported}>{b.section} · {b.location} · {b.text.slice(0, 65)}{!b.supported ? ' (unsupported)' : ''}</option>)}</select></label>
      <label className="block text-sm">Select source text<textarea aria-label="Select source text" readOnly rows={4} className={inputClass} value={selected?.text ?? ''} onSelect={(e) => { manual.setValue('start', e.currentTarget.selectionStart); manual.setValue('end', e.currentTarget.selectionEnd); }} /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Start offset<input className={inputClass} type="number" {...manual.register('start', { valueAsNumber: true })} /></label><label className="text-sm">End offset (exclusive)<input className={inputClass} type="number" {...manual.register('end', { valueAsNumber: true })} /></label></div>
      <p className="whitespace-pre-wrap text-sm">Selected: <mark>{selected?.text.slice(start, end)}</mark></p>
      <label className="block text-sm">Add to field<select className={inputClass} {...manual.register('target')}><option value="">New field</option>{review.fields.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.key})</option>)}</select></label>
      <label className="block text-sm">New field key<input className={inputClass} placeholder="client_name" {...manual.register('key')} /></label>
      <Button type="submit">{editing ? 'Apply corrected range' : 'Add selected occurrence'}</Button>{editing && <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel range edit</Button>}
      </fieldset>
    </form>
    <section aria-label="Exact source highlights" className="max-h-96 space-y-3 overflow-auto rounded border border-border p-4"><h3 className="font-semibold">Exact source highlights</h3>{blocks.map((b) => {
      const occurrences = review.fields.flatMap((f) => f.occurrences).filter((o) => o.blockId === b.id).sort((a, c) => a.start - c.start);
      const overlaps = occurrences.some((o, i) => i > 0 && o.start < (occurrences[i - 1]?.end ?? 0));
      const pieces = []; let cursor = 0;
      for (const o of occurrences) { pieces.push(<span key={`${o.id}-before`}>{b.text.slice(cursor, o.start)}</span>, <mark key={o.id}>{b.text.slice(o.start, o.end)}</mark>); cursor = o.end; }
      pieces.push(<span key="tail">{b.text.slice(cursor)}</span>);
      return <article key={b.id}><p className="text-xs text-muted-foreground">{b.section} · {b.location}</p><p className="whitespace-pre-wrap text-sm">{overlaps ? b.text : pieces}</p>{overlaps && <p className="text-sm text-amber-900">Approved ranges overlap. Remove or edit them before saving.</p>}{b.warnings.map((w) => <p className="text-xs text-amber-900" key={w}>{w}</p>)}</article>;
    })}</section>
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void persist(false)}>Save review</Button><Button disabled={busy || dirty || review.revision === 0 || !review.fields.length} onClick={() => void persist(true)}>Publish saved review</Button><Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const snapshot = reviewSnapshotSchema.parse(await api(`/api/documents/${review.documentId}/fields`)); setReview(snapshot); setDirty(false); setMessage('Saved review reloaded.'); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>Discard edits and reload saved review</Button></div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {version && <p role="status" className="rounded bg-emerald-50 p-4 text-sm text-emerald-900">Published immutable template version {version.versionNumber}. Version ID: {version.versionId}. Template library and filled-document export arrive in Phase 6.</p>}
  </section>;
}
