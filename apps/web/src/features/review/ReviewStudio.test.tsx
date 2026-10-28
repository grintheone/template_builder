// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewSnapshot, SourceBlock } from '@studio/shared';
import { ReviewStudio } from './ReviewStudio';
const documentId = '123e4567-e89b-42d3-a456-426614174000';
const jobId = '123e4567-e89b-42d3-a456-426614174001';
const occurrenceId = '123e4567-e89b-42d3-a456-426614174002';
const sourceHash = 'a'.repeat(64);
const block: SourceBlock = { id: 'word/document.xml::p-000000', partPath: 'word/document.xml', paragraphIndex: 0, section: 'body', text: 'Alex and Alex', location: 'p[1]', supported: true, warnings: [], spans: [{ start: 0, end: 13, textNodeIndex: 0 }] };
let saved: ReviewSnapshot;
let failSave = false;
let polls = 0;
let ambiguous = true;
function mount() {
  saved = { documentId, sourceHash, revision: 0, fields: [], decisions: [] }; failSave = false; polls = 0; ambiguous = true;
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/analyze')) return Response.json({ jobId });
    if (url.includes('/analysis-jobs/')) {
      polls++;
      return Response.json({ jobId, documentId, sourceHash, model: 'fake', status: polls === 1 ? 'running' : 'done', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z', error: null,
        result: polls === 1 ? null : { fields: [{ key: 'client_name', label: 'Client', type: 'text', required: true, confidence: 1, occurrences: [{ id: occurrenceId, blockId: block.id, quote: 'Alex', ...(ambiguous ? { status: 'unresolved', reason: 'ambiguous' } : { status: 'resolved', start: 0, end: 4 }) }] }], warnings: [] } });
    }
    if (options?.method === 'PUT') {
      if (failSave) return Response.json({ message: 'Review changed. Reload first.' }, { status: 409 });
      const { expectedRevision, ...data } = JSON.parse(String(options.body)); saved = { ...data, documentId, revision: expectedRevision + 1 }; return Response.json(saved);
    }
    if (url.endsWith('/publish')) return Response.json({ templateId: documentId, versionId: jobId, versionNumber: 1, sourceHash, reviewRevision: saved.revision, createdAt: '2026-10-28T00:00:00.000Z', fields: saved.fields });
    return Response.json(saved);
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}><ReviewStudio documentId={documentId} sourceHash={sourceHash} blocks={[block]} /></QueryClientProvider>);
  return { ...view, remount: () => { view.unmount(); client.clear(); return render(<QueryClientProvider client={client}><ReviewStudio documentId={documentId} sourceHash={sourceHash} blocks={[block]} /></QueryClientProvider>); } };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function addManual() {
  await screen.findByText('No occurrences approved yet.');
  fireEvent.change(screen.getByLabelText('Start offset'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('End offset (exclusive)'), { target: { value: '13' } });
  fireEvent.change(screen.getByLabelText('New field key'), { target: { value: 'client_name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add selected occurrence' }));
  await screen.findByLabelText('Key client_name');
}
it('adds explicit manual ranges, retains edits after failed save, reloads persisted state and publishes', async () => {
  const view = mount(); await addManual();
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Publish saved review' }).disabled).toBe(true);
  const highlight = screen.getByRole('region', { name: 'Exact source highlights' });
  expect(highlight.querySelectorAll('mark')).toHaveLength(1); expect(highlight.querySelector('mark')?.textContent).toBe('Alex');
  failSave = true; fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review changed. Reload first.'); expect(screen.getByLabelText<HTMLInputElement>('Key client_name').value).toBe('client_name');
  failSave = false; fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review saved.');
  expect(saved.fields[0]?.occurrences[0]).toMatchObject({ start: 9, end: 13, quote: 'Alex' });
  view.remount(); await screen.findByLabelText('Key client_name');
  fireEvent.click(screen.getByRole('button', { name: 'Publish saved review' })); await screen.findByText(/Published immutable template version 1/);
});
it('polls analysis, leaves ambiguous suggestions pending and records rejection on manual correction', async () => {
  mount(); await screen.findByText('No occurrences approved yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Start local AI analysis' })); await screen.findByText('Analysis: running');
  await screen.findByText(/Needs correction: ambiguous/, {}, { timeout: 4000 }); expect(polls).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Approve occurrence' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Correct manually' })); await addManual();
  fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review saved.');
  expect(saved.decisions).toEqual([{ occurrenceId, status: 'rejected' }]); expect(saved.fields[0]?.occurrences[0]?.provenance).toBeUndefined();
});
it('edits a range to a distinct occurrence, renames a field and removes it', async () => {
  mount(); await addManual();
  fireEvent.click(screen.getByRole('button', { name: 'Edit range' }));
  fireEvent.change(screen.getByLabelText('Start offset'), { target: { value: '0' } }); fireEvent.change(screen.getByLabelText('End offset (exclusive)'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply corrected range' }));
  const approved = screen.getByRole('region', { name: 'Approved fields' }); await waitFor(() => expect(within(approved).getByText(/0–4/)).toBeTruthy());
  const keyInput = screen.getByLabelText('Key client_name'); await userEvent.clear(keyInput); await userEvent.type(keyInput, 'employee_name');
  fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review saved.'); expect(saved.fields[0]?.key).toBe('employee_name');
  fireEvent.click(screen.getByRole('button', { name: 'Remove field' })); await screen.findByText('No occurrences approved yet.');
});

it('approves a resolved occurrence only on request and records rejection when its range is edited', async () => {
  mount(); ambiguous = false;
  await screen.findByText('No occurrences approved yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Start local AI analysis' }));
  await screen.findByText(/range 0–4/, {}, { timeout: 4000 });
  expect(screen.queryByLabelText('Key client_name')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Approve occurrence' })); await screen.findByLabelText('Key client_name');
  fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review saved.');
  expect(saved.decisions[0]).toMatchObject({ status: 'accepted', occurrenceId });
  expect(saved.fields[0]?.occurrences[0]?.provenance).toEqual({ analysisJobId: jobId, occurrenceId });
  fireEvent.click(screen.getByRole('button', { name: 'Edit range' }));
  fireEvent.change(screen.getByLabelText('Start offset'), { target: { value: '9' } }); fireEvent.change(screen.getByLabelText('End offset (exclusive)'), { target: { value: '13' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply corrected range' }));
  await screen.findByText(/9–13/);
  fireEvent.click(screen.getByRole('button', { name: 'Save review' })); await screen.findByText('Review saved.');
  expect(saved.decisions).toEqual([{ occurrenceId, status: 'rejected' }]); expect(saved.fields[0]?.occurrences[0]?.provenance).toBeUndefined();
});
