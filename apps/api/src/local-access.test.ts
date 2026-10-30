import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerLocalAccess } from './local-access.js';

it('rejects remote browser origins, cross-site posts and DNS rebinding before route execution', async () => {
  const app = Fastify(); registerLocalAccess(app);
  let calls = 0;
  app.post('/api/test', async () => { calls++; return { ok: true }; });
  try {
    for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { host: '127.0.0.1.evil.example' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/test', headers });
      expect(response.statusCode).toBe(403); expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(calls).toBe(0);
    for (const headers of [{}, { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:5173' }, { host: 'localhost:3001', origin: 'http://localhost:4173' }])
      expect((await app.inject({ method: 'POST', url: '/api/test', headers })).statusCode).toBe(200);
    expect(calls).toBe(3);
  } finally { await app.close(); }
});
