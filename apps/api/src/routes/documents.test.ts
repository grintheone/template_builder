import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { afterEach, describe, expect, it } from 'vitest';
import { documentBlocksSchema, documentImportSchema } from '@studio/shared';
import { buildApp } from '../app.js';
import { readConfig } from '../config.js';
import { createDocxFixture } from '../testing/docx-fixture.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
function setup(max = 15) {
  const base = readConfig({});
  mkdirSync(base.STORAGE_DIR, { recursive: true });
  const directory = mkdtempSync(resolve(base.STORAGE_DIR, 'import-test-'));
  const config = { ...base, MAX_UPLOAD_MB: max, DATABASE_PATH: resolve(directory, 'app.sqlite'), STORAGE_DIR: resolve(directory, 'files') };
  const app = buildApp(config, async () => { throw new Error('No AI during import'); });
  cleanup.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, config };
}
function upload(source = createDocxFixture(), filename = 'source.docx') {
  return { method: 'POST' as const, url: '/api/documents', headers: { 'content-type': 'multipart/form-data; boundary=import-test' }, payload: Buffer.concat([
    Buffer.from(`--import-test\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), source, Buffer.from('\r\n--import-test--\r\n'),
  ]) };
}
describe('document import API', () => {
  it('persists exact immutable bytes, hash and stable index across restarts', async () => {
    const { app, config } = setup();
    const source = createDocxFixture();
    const imported = await app.inject(upload(source));
    expect(imported.statusCode).toBe(201);
    const { documentId, sourceHash } = documentImportSchema.parse(imported.json());
    expect(sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
    const path = resolve(config.STORAGE_DIR, 'originals', `${documentId}.docx`);
    expect(readFileSync(path)).toEqual(source);
    const result = await app.inject(`/api/documents/${documentId}/blocks`);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    documentBlocksSchema.parse(result.json());
    await app.close();
    const restarted = buildApp(config);
    try { expect((await restarted.inject(`/api/documents/${documentId}/blocks`)).json()).toEqual(result.json()); }
    finally { await restarted.close(); }
    expect(readFileSync(path)).toEqual(source);
    chmodSync(path, 0o600); writeFileSync(path, 'tampered private data');
    const tampered = buildApp(config);
    try {
      const response = await tampered.inject(`/api/documents/${documentId}/blocks`);
      expect(response.statusCode).toBe(500); expect(response.body).not.toContain('private data');
    } finally { await tampered.close(); }
  });
  it.each(['source.doc', 'source.docm', 'source.zip'])('rejects %s without storing a source', async (name) => {
    const { app, config } = setup();
    expect((await app.inject(upload(undefined, name))).statusCode).toBe(422);
    expect(readdirSync(config.STORAGE_DIR)).toEqual([]);
  });
  it.each(['invalid zip', 'missing main', 'traversal', 'unknown part', 'malformed XML', 'expanded size', 'encrypted'])('rejects %s', async (kind) => {
    const { app } = setup();
    const zip = new PizZip(createDocxFixture());
    if (kind === 'missing main') zip.remove('word/document.xml');
    if (kind === 'traversal') zip.file('../escape.xml', 'bad');
    if (kind === 'unknown part') zip.file('word/vbaProject.bin', 'bad');
    if (kind === 'malformed XML') zip.file('word/document.xml', '<broken>');
    if (kind === 'expanded size') zip.file('word/styles.xml', 'x'.repeat(10 * 1024 * 1024 + 1));
    const source = kind === 'invalid zip' ? Buffer.from('private data') : zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    if (kind === 'encrypted') {
      const central = source.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      source.writeUInt16LE(source.readUInt16LE(central + 8) | 1, central + 8);
    }
    const response = await app.inject(upload(source));
    expect(response.statusCode).toBe(kind === 'expanded size' ? 413 : 422);
    expect(response.body).not.toContain('private data');
  });
  it('rejects oversized uploads and malformed/missing IDs', async () => {
    const { app } = setup(0.001);
    expect((await app.inject(upload())).statusCode).toBe(413);
    expect((await app.inject('/api/documents/invalid/blocks')).statusCode).toBe(400);
    expect((await app.inject(`/api/documents/${randomUUID()}/blocks`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/documents', payload: {} })).statusCode).toBe(422);
  });
});
