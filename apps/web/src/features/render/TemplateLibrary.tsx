import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { createFormValuesSchema, exportErrorSchema, templateDetailSchema, templateLibrarySchema, type TemplateDetail } from '@studio/shared';
import { Button } from '@/components/ui/button';

const inputClass = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm';
async function getJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load published templates. Check the local API and refresh.');
  return response.json();
}
export function TemplateLibrary({ pdfAvailable }: { pdfAvailable?: boolean }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string>();
  const library = useQuery({ queryKey: ['templates'], queryFn: async () => templateLibrarySchema.parse(await getJson('/api/templates')) });
  const detail = useQuery({ queryKey: ['template', selected], enabled: !!selected, queryFn: async () => templateDetailSchema.parse(await getJson(`/api/templates/${selected}`)) });
  const matches = library.data?.filter((t) => `${t.title} ${t.templateId} ${t.fields.map((f) => `${f.key} ${f.label}`).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="mt-10 rounded-xl border border-border bg-card p-6 sm:p-8" aria-labelledby="library-title">
    <div className="flex items-center justify-between gap-4"><h2 id="library-title" className="text-xl font-semibold">Template library</h2><Button variant="outline" onClick={() => { void library.refetch(); if (selected) void detail.refetch(); }}>Refresh templates</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Choose a published template and fill a new document. Saved templates work without Ollama.</p>
    <label className="mt-5 block text-sm" htmlFor="template-search">Search templates</label><input id="template-search" className={`${inputClass} mt-2`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Template ID or field label" />
    {library.isPending && <p role="status">Loading templates…</p>}
    {library.error && <p role="alert">{library.error.message}</p>}
    {library.data?.length === 0 && <p className="mt-4 text-sm">No published templates yet. Review and publish a document below.</p>}
    {library.data && library.data.length > 0 && matches?.length === 0 && <p className="mt-4 text-sm">No matching templates.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{matches?.map((template) => <button key={template.templateId} type="button" aria-pressed={selected === template.templateId} className={`rounded-lg border p-4 text-left ${selected === template.templateId ? 'border-primary bg-muted' : 'border-border'}`} onClick={() => setSelected(template.templateId)}><span className="font-medium">{template.title}</span><span className="mt-1 block text-sm text-muted-foreground">Version {template.versionNumber} · {template.fields.length} fields</span><span className="mt-1 block text-xs text-muted-foreground">{template.fields.map((f) => f.label).join(', ')}</span></button>)}</div>
    {detail.isFetching && selected && <p role="status">Loading template…</p>}
    {detail.error && <p role="alert">{detail.error.message}</p>}
    {detail.data && detail.data.templateId === selected && <TemplateForm key={detail.data.versionId} template={detail.data} pdfAvailable={pdfAvailable} />}
  </section>;
}
export function TemplateForm({ template, pdfAvailable }: { template: TemplateDetail; pdfAvailable?: boolean }) {
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx');
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Record<string, string | number>>({ defaultValues: Object.fromEntries(template.fields.map((f) => [f.key, f.default ?? ''])) });
  const schema = createFormValuesSchema(template.fields);
  async function submit(values: Record<string, string | number>) {
    setResult(undefined);
    const parsed = schema.safeParse(values);
    if (!parsed.success) { for (const issue of parsed.error.issues) setError(String(issue.path[0]), { message: issue.message }); return; }
    try {
      const response = await fetch(`/api/templates/${template.templateId}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: template.versionId, format, values: parsed.data }), signal: AbortSignal.timeout(90000) });
      if (!response.ok) { const error = exportErrorSchema.safeParse(await response.json()); throw new Error(error.success ? error.data.message : 'The document could not be exported.'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `document.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setResult({ ok: true, message: `Your ${format.toUpperCase()} download is ready.` });
    } catch (error) { setResult({ ok: false, message: error instanceof Error && error.name === 'Error' ? error.message : 'Export could not finish. Check the API and try again.' }); }
  }
  return <div className="mt-6 border-t border-border pt-6"><h3 className="text-lg font-semibold">Fill {template.title}</h3><p className="mt-1 text-xs text-muted-foreground">Published version {template.versionNumber} · {new Date(template.createdAt).toLocaleDateString()} · {template.versionId}</p>
    <form noValidate onSubmit={handleSubmit(submit)} className="mt-5 space-y-4">
      {template.fields.map((field) => <div key={field.key}><label htmlFor={`fill-${field.key}`} className="mb-2 block text-sm font-medium">{field.label} {field.required ? '(required)' : '(optional)'}</label><input id={`fill-${field.key}`} className={inputClass} type={field.type === 'date' ? 'date' : field.type === 'text' ? 'text' : 'number'} step={field.type === 'number' || field.type === 'currency' ? 'any' : undefined} aria-invalid={!!errors[field.key]} aria-describedby={`help-${field.key}`} {...register(field.key, { setValueAs: (value: unknown) => (field.type === 'number' || field.type === 'currency') && typeof value === 'string' && value !== '' ? Number(value) : value, validate: (value) => { const checked = schema.shape[field.key]?.safeParse(value); return !checked || checked.success || checked.error.issues[0]?.message || 'Check this value.'; } })} />
        <p id={`help-${field.key}`} className="mt-1 text-xs text-muted-foreground">{field.type === 'currency' ? `${field.formatting.currency} · ${field.formatting.locale}` : field.type === 'date' ? 'Export format: YYYY-MM-DD' : field.type === 'number' ? `Number format: ${field.formatting.locale}` : ''}</p>{errors[field.key] && <p role="alert" className="mt-1 text-sm text-destructive">{errors[field.key]?.message}</p>}</div>)}
      <label htmlFor="export-format" className="block text-sm font-medium">Download format</label><select id="export-format" className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as 'docx' | 'pdf')}><option value="docx">Word document (.docx)</option><option value="pdf" disabled={pdfAvailable !== true}>PDF (.pdf)</option></select>
      {pdfAvailable !== true && <p className="text-sm text-muted-foreground">PDF requires a ready LibreOffice installation. DOCX is available.</p>}
      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Exporting…' : 'Download document'}</Button>
      {result && <p role={result.ok ? 'status' : 'alert'} className="text-sm">{result.message}</p>}
    </form>
  </div>;
}
