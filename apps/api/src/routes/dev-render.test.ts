import PizZip from 'pizzip';
import { afterEach, describe, expect, it } from 'vitest';
import { DOCX_MIME_TYPE, renderErrorSchema } from '@studio/shared';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { createDocxFixture, paragraph } from '../testing/docx-fixture.js';

const boundary = 'studio-test-boundary';
const file = (buffer = createDocxFixture(), filename = 'template.docx', field = 'template') => Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${DOCX_MIME_TYPE}\r\n\r\n`), buffer, Buffer.from('\r\n'),
]);
const field = (value: string, name = 'values') => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
const payload = (...parts: Buffer[]) => Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
const goodValues = JSON.stringify({ client_name: 'Мария & Co', amount: 1250.5 });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
function app(maxUploadMb = 15) {
  const result = buildApp({ ...readConfig({}), MAX_UPLOAD_MB: maxUploadMb }, async () => { throw new Error('Ollama must not be used when rendering'); });
  apps.push(result);
  return result;
}
const request = (body: Buffer) => ({ method: 'POST' as const, url: '/api/dev/render', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });

describe('POST /api/dev/render', () => {
  it.each([false, true])('downloads a DOCX independent of multipart field order (file first: %s)', async (fileFirst) => {
    const body = fileFirst ? payload(file(), field(goodValues)) : payload(field(goodValues), file());
    const response = await app().inject(request(body));
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain(DOCX_MIME_TYPE);
    expect(response.headers['content-disposition']).toBe('attachment; filename="rendered.docx"');
    expect(response.headers['cache-control']).toBe('no-store');
    const zip = new PizZip(response.rawPayload);
    expect(zip.file('word/document.xml')?.asText()).toContain('Мария &amp; Co');
  });
  it.each([
    ['missing file', () => payload(field(goodValues))],
    ['missing values', () => payload(file())],
    ['wrong file extension', () => payload(file(undefined, 'template.docm'), field(goodValues))],
    ['wrong file field', () => payload(file(undefined, 'template.docx', 'other'), field(goodValues))],
    ['wrong values field', () => payload(file(), field(goodValues, 'other'))],
    ['invalid JSON', () => payload(file(), field('{invalid personal data'))],
    ['non-object values', () => payload(file(), field('null'))],
    ['unknown keys', () => payload(file(), field('{"unknown_key":"personal data"}'))],
    ['missing key', () => payload(file(), field('{"client_name":"personal data"}'))],
    ['invalid DOCX', () => payload(file(Buffer.from('not a DOCX')), field(goodValues))],
    ['malformed tags', () => payload(file(createDocxFixture({ body: paragraph('[[client_name] personal data') })), field(goodValues))],
  ] as const)('rejects %s with a sanitized contract', async (_label, makePayload) => {
    const response = await app().inject(request(makePayload()));
    expect(response.statusCode).toBe(422);
    expect(renderErrorSchema.safeParse(response.json()).success).toBe(true);
    expect(response.body).not.toContain('personal data');
    expect(response.body).not.toContain('stack');
  });
  it('rejects a file beyond the configured limit', async () => {
    const response = await app(0.001).inject(request(payload(file(), field(goodValues))));
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('UPLOAD_TOO_LARGE');
  });
  it('rejects oversized values instead of parsing a truncated JSON prefix', async () => {
    const response = await app().inject(request(payload(file(), field(' '.repeat(70 * 1024)))));
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('UPLOAD_TOO_LARGE');
  });
  it.each([
    () => payload(file(), file(), field(goodValues)),
    () => payload(file(), field(goodValues), field(goodValues)),
  ])('rejects excess multipart parts', async (makePayload) => {
    const response = await app().inject(request(makePayload()));
    expect(response.statusCode).toBe(413);
  });
  it('rejects a non-multipart request', async () => {
    const response = await app().inject({ method: 'POST', url: '/api/dev/render', payload: { values: {} } });
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('INVALID_REQUEST');
  });
  it('rejects a broken multipart request', async () => {
    const response = await app().inject(request(Buffer.from('broken boundary')));
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});
