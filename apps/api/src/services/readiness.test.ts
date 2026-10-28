import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLibreOffice, checkOllama } from './readiness.js';
import { readConfig } from '../config.js';

const config = readConfig({});
afterEach(() => vi.unstubAllGlobals());

describe('optional dependencies', () => {
  it('handles offline Ollama without rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private error')));
    const result = await checkOllama(config);
    expect(result.available).toBe(false);
    expect(result.modelAvailable).toBe(false);
    expect(result.message).not.toContain('private error');
  });
  it('distinguishes a running server from a missing model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [] }))));
    expect(await checkOllama(config)).toMatchObject({ available: true, modelAvailable: false });
  });
  it('recognizes the configured model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }] }))));
    expect(await checkOllama(config)).toMatchObject({ available: true, modelAvailable: true });
  });
  it('turns malformed Ollama results into an unavailable status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid')));
    expect((await checkOllama(config)).available).toBe(false);
  });
  it('bounds the request and disables redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [] })));
    vi.stubGlobal('fetch', fetch);
    await checkOllama(config);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('handles a missing LibreOffice binary without rejecting', async () => {
    expect(await checkLibreOffice({ ...config, SOFFICE_PATH: '/nonexistent/studio-soffice' })).toMatchObject({ available: false });
  });
});
