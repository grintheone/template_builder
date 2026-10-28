import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Download, FileUp } from 'lucide-react';
import { MAX_VALUES_BYTES, renderErrorSchema, renderValuesSchema } from '@studio/shared';
import { Button } from '@/components/ui/button';

type DemoForm = { template: FileList; values: string };
const sampleValues = JSON.stringify({ client_name: 'Иван Smith', amount: 1250.5 }, null, 2);
const inputClass = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function RenderDemo() {
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<DemoForm>({ defaultValues: { values: sampleValues } });
  async function render(form: DemoForm) {
    setResult(undefined);
    const file = form.template[0];
    if (!file) return;
    const data = new FormData();
    data.set('values', form.values);
    data.set('template', file);
    try {
      const response = await fetch('/api/dev/render', { method: 'POST', body: data, signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        const error = renderErrorSchema.safeParse(await response.json());
        setResult({ ok: false, message: error.success ? error.data.message : 'The local API could not render this document. Check the template and try again.' });
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'rendered.docx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setResult({ ok: true, message: 'Your DOCX is ready. Open rendered.docx in Word or LibreOffice to check the result.' });
    } catch {
      setResult({ ok: false, message: 'Could not complete the request. Check that the local API is running and try again.' });
    }
  }
  return <section className="mt-10 rounded-xl border border-border bg-card p-6 sm:p-8" aria-labelledby="render-title">
    <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-widest text-primary">Phase 2 · Rendering proof of concept</p><h2 id="render-title" className="mt-3 text-xl font-semibold">Try a tagged DOCX</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Upload a document with manually inserted <code>[[client_name]]</code> tags, enter a value for every field, and download a filled copy. Your original stays unchanged.</p></div>
    <form onSubmit={handleSubmit(render)} className="space-y-5" noValidate>
      <div><label htmlFor="template" className="mb-2 flex items-center gap-2 text-sm font-medium"><FileUp size={16} />Tagged DOCX</label><input id="template" type="file" accept=".docx" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm`} aria-invalid={Boolean(errors.template)} aria-describedby={errors.template ? 'template-error' : 'template-help'} {...register('template', { validate: (files) => (files?.length === 1 && /\.docx$/i.test(files[0]?.name ?? '')) || 'Choose one .docx file.' })} />
        <p id="template-help" className="mt-2 text-xs text-muted-foreground">Standard DOCX only. The server enforces MAX_UPLOAD_MB (15 MiB by default). Files are processed in memory.</p>{errors.template && <p id="template-error" role="alert" className="mt-2 text-sm text-destructive">{errors.template.message}</p>}
      </div>
      <div><label htmlFor="values" className="mb-2 block text-sm font-medium">Field values (JSON)</label><textarea id="values" rows={6} spellCheck={false} className={`${inputClass} font-mono leading-6`} aria-invalid={Boolean(errors.values)} aria-describedby={errors.values ? 'values-error' : 'values-help'} {...register('values', { validate: (value) => {
        if (new TextEncoder().encode(value).length > MAX_VALUES_BYTES) return 'Keep values below 64 KiB.';
        try { return renderValuesSchema.safeParse(JSON.parse(value)).success || 'Use an object with snake_case keys and text or finite numbers.'; } catch { return 'Enter valid JSON, for example {"client_name":"Alex"}.'; }
      } })} />
        <p id="values-help" className="mt-2 text-xs leading-5 text-muted-foreground">Keys must match every tag exactly. All fields are required; use an empty string for a blank value. Text and numbers only. Loops, expressions, images, and raw XML substitutions are not supported.</p>{errors.values && <p id="values-error" role="alert" className="mt-2 text-sm text-destructive">{errors.values.message}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4"><Button type="submit" disabled={isSubmitting}><Download size={16} />{isSubmitting ? 'Rendering…' : 'Render and download DOCX'}</Button><span className="text-xs text-muted-foreground">Works without Ollama or LibreOffice.</span></div>
      {result && <p role={result.ok ? 'status' : 'alert'} className={`rounded-lg border p-3 text-sm ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{result.message}</p>}
    </form>
  </section>;
}
