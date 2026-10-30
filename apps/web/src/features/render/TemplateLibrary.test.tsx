// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TemplateDetail } from '@studio/shared';
import { TemplateForm, TemplateLibrary } from './TemplateLibrary';
const id = '123e4567-e89b-42d3-a456-426614174000';
const template: TemplateDetail = { title: 'Template 123e4567', templateId: id, versionId: id, versionNumber: 1, reviewRevision: 1, sourceHash: 'a'.repeat(64), createdAt: '2026-10-28T00:00:00.000Z', fields: [
  { id, key: 'name', label: 'Employee', type: 'text', required: true, formatting: {} },
  { id, key: 'date', label: 'Start date', type: 'date', required: true, formatting: { dateFormat: 'YYYY-MM-DD' } },
  { id, key: 'salary', label: 'Salary', type: 'currency', required: true, default: 1200, formatting: { currency: 'USD', locale: 'en-US' } },
  { id, key: 'count', label: 'Count', type: 'number', required: false, formatting: { locale: 'en-US' } },
] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('searches published fields, selects a template and shows typed controls with PDF readiness', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/templates' ? [template] : template)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><TemplateLibrary pdfAvailable={false} /></QueryClientProvider>);
  await screen.findByRole('button', { name: /Template 123e4567/ });
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'unmatched' } }); await screen.findByText('No matching templates.');
  fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'employee' } });
  fireEvent.click(screen.getByRole('button', { name: /Template 123e4567/ }));
  await screen.findByLabelText('Employee (required)');
  expect(screen.getByLabelText<HTMLInputElement>('Start date (required)').type).toBe('date');
  expect(screen.getByLabelText<HTMLInputElement>('Salary (required)').type).toBe('number');
  expect(screen.getByLabelText<HTMLInputElement>('Salary (required)').value).toBe('1200');
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'PDF (.pdf)' }).disabled).toBe(true);
  client.clear();
});
it('validates required fields, sends typed values and pinned version, then downloads', async () => {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response('docx')); vi.stubGlobal('fetch', fetch);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<TemplateForm template={template} pdfAvailable />);
  fireEvent.click(screen.getByRole('button', { name: 'Download document' }));
  await screen.findByText('This field is required.'); expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Employee (required)'), { target: { value: 'Иван Петров' } });
  fireEvent.change(screen.getByLabelText('Start date (required)'), { target: { value: '2028-02-29' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download document' }));
  await screen.findByText('Your DOCX download is ready.');
  expect(click).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ versionId: id, format: 'docx', values: { name: 'Иван Петров', date: '2028-02-29', salary: 1200, count: '' } });
});
it('retains entered values after an actionable PDF error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'PDF_FAILED', message: 'LibreOffice could not convert this document.' }, { status: 422 })));
  render(<TemplateForm template={template} pdfAvailable />);
  fireEvent.change(screen.getByLabelText('Employee (required)'), { target: { value: 'Alex' } });
  fireEvent.change(screen.getByLabelText('Start date (required)'), { target: { value: '2028-02-29' } });
  fireEvent.change(screen.getByLabelText('Download format'), { target: { value: 'pdf' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download document' }));
  await screen.findByText('LibreOffice could not convert this document.');
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Employee (required)').value).toBe('Alex'));
});
