import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { documentImportSchema, documentBlocksSchema } from '@studio/shared';
import { Button } from '@/components/ui/button';

async function failure(response: Response): Promise<never> {
  const error = await response.json().catch(() => null);
  throw new Error(typeof error?.message === 'string' ? error.message : 'The local service could not process this document.');
}
export function DocumentImport() {
  const [file, setFile] = useState<File>();
  const upload = useMutation({ mutationFn: async (document: File) => {
    const body = new FormData(); body.append('document', document);
    const response = await fetch('/api/documents', { method: 'POST', body });
    if (!response.ok) return failure(response);
    return documentImportSchema.parse(await response.json());
  } });
  const id = upload.data?.documentId;
  const index = useQuery({ queryKey: ['document-blocks', id], enabled: !!id, retry: false, queryFn: async () => {
    const response = await fetch(`/api/documents/${id}/blocks`);
    if (!response.ok) return failure(response);
    return documentBlocksSchema.parse(await response.json());
  } });
  return <section className="mt-12 rounded-xl border border-border bg-card p-6" aria-labelledby="import-title">
    <h2 id="import-title" className="text-lg font-semibold">Import a source DOCX</h2>
    <p className="mt-2 text-sm text-muted-foreground">Store the original and inspect extracted paragraphs, tables, headers and footers. This is a text view; page layout is not reproduced. No document content is sent to AI.</p>
    <form className="mt-5 flex flex-wrap items-end gap-4" onSubmit={(event) => { event.preventDefault(); if (file) upload.mutate(file); }}>
      <label className="grid gap-2 text-sm" htmlFor="source-docx">Source document<input id="source-docx" className="max-w-full rounded border border-border p-2" type="file" accept=".docx" disabled={upload.isPending} onChange={(event) => { setFile(event.target.files?.[0]); upload.reset(); }} /></label>
      <Button type="submit" disabled={!file || upload.isPending}>{upload.isPending ? 'Importing…' : 'Import and inspect'}</Button>
    </form>
    {(upload.error || index.error) && <p role="alert" className="mt-4 text-sm text-red-800">{(upload.error || index.error)?.message}</p>}
    {id && <div className="mt-5 space-y-3" aria-live="polite">
      <p className="break-all text-xs text-muted-foreground">Saved document: {id}<br />SHA-256: {upload.data?.sourceHash}</p>
      {index.isFetching && <p className="text-sm">Loading source text…</p>}
      {index.data && <>
        <p className="text-sm">{index.data.blocks.length} paragraphs. Blank paragraphs are retained. Highlighted blocks require manual review.</p>
        {index.data.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">{index.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <div className="max-h-[36rem] space-y-3 overflow-auto">{index.data.blocks.map((block) => <article key={block.id} className={`rounded-lg border p-4 ${block.supported ? 'border-border' : 'border-amber-300 bg-amber-50'}`}>
          <p className="break-all text-xs text-muted-foreground">{block.section} · {block.partPath} · {block.location}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{block.text || '(blank paragraph)'}</p>
          {block.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-900">{warning}</p>)}
        </article>)}</div>
      </>}
    </div>}
  </section>;
}
