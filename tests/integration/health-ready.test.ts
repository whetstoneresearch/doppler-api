import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

describe('health endpoints', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('responds on /health and /ready without auth', async () => {
    app = await buildTestServer();

    const health = await app.inject({ method: 'GET', url: '/health' });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });

    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(metrics.statusCode).toBe(200);
    expect(health.headers['x-request-id']).toBeDefined();
    expect(metrics.json().http.totalRequests).toBeGreaterThan(0);
  });

  it('returns sanitized readiness errors when chain checks fail', async () => {
    app = await buildTestServer({ readyCheckFails: true });

    const ready = await app.inject({ method: 'GET', url: '/ready' });

    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: 'degraded',
      checks: [
        {
          chainId: 84532,
          ok: false,
          error: 'dependency unavailable',
        },
      ],
    });
  });
});
