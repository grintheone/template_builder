import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

const offlineHealth = {
  api: { available: true, message: 'Ready' },
  ollama: { available: false, message: 'Start Ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b', modelAvailable: false },
  libreOffice: { available: false, message: 'Install LibreOffice', binary: 'soffice' },
};

describe('health contract', () => {
  it('accepts optional services being offline', () => {
    expect(healthResponseSchema.parse(offlineHealth)).toEqual(offlineHealth);
  });
  it('rejects malformed health responses', () => {
    expect(healthResponseSchema.safeParse({ ...offlineHealth, api: { available: false } }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...offlineHealth, ollama: { ...offlineHealth.ollama, endpoint: 'invalid' } }).success).toBe(false);
  });
});
