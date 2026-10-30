import type { FastifyInstance } from 'fastify';

function loopback(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

// Loopback binding alone does not stop a hostile website posting to localhost
// or using DNS rebinding. Do not trust forwarded host/origin headers.
export function registerLocalAccess(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    const origin = request.headers.origin;
    if (!loopback(`http://${request.headers.host ?? ''}`) || (origin !== undefined && !loopback(origin))
      || request.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send({ code: 'LOCAL_ACCESS_ONLY', message: 'Open the app using its local 127.0.0.1 address.' });
    }
  });
}
