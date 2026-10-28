import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';

describe('local configuration', () => {
  it('defaults to loopback and local data', () => {
    const config = readConfig({});
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.API_PORT).toBe(3001);
    expect(config.DATABASE_PATH).toMatch(/\/data\/app.sqlite$/);
  });
  it.each([
    { HOST: '0.0.0.0' }, { API_PORT: 'invalid' }, { API_PORT: '65536' },
    { OLLAMA_BASE_URL: 'https://example.com' }, { OLLAMA_BASE_URL: 'file://localhost/tmp' },
    { DATABASE_PATH: '../private.sqlite' }, { STORAGE_DIR: './data/../../outside' },
    { MAX_UPLOAD_MB: '-1' },
    { OLLAMA_MODEL: 'qwen3:cloud' }, { ANALYSIS_TIMEOUT_MS: '0' }, { ANALYSIS_TIMEOUT_MS: '600001' },
  ])('rejects unsafe settings: %o', (env) => {
    expect(() => readConfig(env)).toThrow();
  });
});
