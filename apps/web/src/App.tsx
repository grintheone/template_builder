import { TemplateLibrary } from '@/features/render/TemplateLibrary';
import { DocumentImport } from '@/features/documents/DocumentImport';
import { useQuery } from '@tanstack/react-query';
import { FileText, RefreshCw, ShieldCheck, CircleCheck, CircleAlert, CircleDashed } from 'lucide-react';
import { healthResponseSchema } from '@studio/shared';
import { Button } from '@/components/ui/button';
import { RenderDemo } from '@/features/render/RenderDemo';

async function fetchHealth() {
  const response = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Health request failed');
  return healthResponseSchema.parse(await response.json());
}

function StatusCard({ title, ready, detail, message }: { title: string; ready: boolean | undefined; detail: string; message: string }) {
  const Icon = ready === undefined ? CircleDashed : ready ? CircleCheck : CircleAlert;
  return <article className="rounded-xl border border-border bg-card p-6 shadow-sm">
    <div className="mb-5 flex items-center justify-between gap-3"><h3 className="font-semibold">{title}</h3><span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ready === undefined ? 'bg-muted text-muted-foreground' : ready ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}><Icon size={13} />{ready === undefined ? 'Unknown' : ready ? 'Ready' : 'Needs attention'}</span></div>
    <p className="mb-3 break-all font-mono text-xs text-muted-foreground">{detail}</p><p className="text-sm leading-6 text-muted-foreground">{message}</p>
  </article>;
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 15000, retry: false });
  const data = health.isError ? undefined : health.data;
  const fallback = health.isPending ? 'Checking local service…' : 'Status unavailable. Start the API and refresh.';
  return <div className="min-h-screen">
    <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><a className="flex items-center gap-3 font-semibold tracking-tight" href="/"><span className="rounded-lg bg-primary p-2 text-primary-foreground"><FileText size={20} /></span>Local DOCX Studio</a><span className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={16} />Local workspace</span></div></header>
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Workspace overview</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your document studio, on your device.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">Check your local services before working with documents. Your files and model connection stay on this computer.</p>
      <section className="mt-12" aria-labelledby="services-title"><div className="mb-5 flex items-center justify-between gap-4"><div><h2 id="services-title" className="text-lg font-semibold">Local services</h2><p className="mt-1 text-sm text-muted-foreground">Automatically checked every 15 seconds.</p></div><Button variant="outline" disabled={health.isFetching} onClick={() => void health.refetch()}><RefreshCw size={15} className={health.isFetching ? 'animate-spin' : ''} />Refresh</Button></div>
        {health.isError && <p role="alert" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Cannot reach the local API. Run pnpm dev and check the API terminal for startup errors.</p>}
        <div className="grid gap-4 md:grid-cols-3" aria-live="polite">
          <StatusCard title="Studio API" ready={health.isError ? false : data?.api.available} detail="/api/health" message={data?.api.message ?? fallback} />
          <StatusCard title="Ollama model" ready={data ? data.ollama.available && data.ollama.modelAvailable : undefined} detail={data ? `${data.ollama.endpoint} · ${data.ollama.model}` : 'Configured local endpoint and model'} message={data?.ollama.message ?? fallback} />
          <StatusCard title="LibreOffice" ready={data?.libreOffice.available} detail={data?.libreOffice.binary ?? 'Configured local executable'} message={data?.libreOffice.message ?? fallback} />
        </div>
      </section>
      <TemplateLibrary pdfAvailable={data?.libreOffice.available} />
      <DocumentImport />
      <RenderDemo />
      <footer className="mt-10 text-xs text-muted-foreground">Single user. Local storage. No cloud AI or telemetry.</footer>
    </main>
  </div>;
}
