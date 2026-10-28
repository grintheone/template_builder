import { describe, expect, it } from 'vitest';
import { healthResponseSchema, type HealthResponse } from '@studio/shared';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig({});
const offline: HealthResponse = {
  api: { available: true, message: 'Ready' },
  ollama: { available: false, modelAvailable: false, message: 'Start Ollama', endpoint: config.OLLAMA_BASE_URL, model: config.OLLAMA_MODEL },
  libreOffice: { available: false, message: 'Install LibreOffice', binary: config.SOFFICE_PATH },
};

describe('GET /api/health', () => {
  it('returns 200 and a valid contract when optional dependencies are offline', async () => {
    const app = buildApp(config, async () => offline);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(healthResponseSchema.parse(response.json())).toEqual(offline);
    } finally { await app.close(); }
  });
  it('sanitizes unexpected errors', async () => {
    const app = buildApp(config, async () => { throw new Error('sensitive source text'); });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('sensitive');
    } finally { await app.close(); }
  });
});
