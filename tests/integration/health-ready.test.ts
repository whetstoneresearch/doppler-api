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

  it('keeps /health public but requires auth on /ready and /metrics', async () => {
    app = await buildTestServer();

    const health = await app.inject({ method: 'GET', url: '/health' });
    const readyUnauthorized = await app.inject({
      method: 'GET',
      url: '/ready',
    });
    const metricsUnauthorized = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    const capabilitiesUnauthorized = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
    });
    const readyAuthorized = await app.inject({
      method: 'GET',
      url: '/ready',
      headers: { 'x-api-key': 'test-key' },
    });
    const metricsAuthorized = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'x-api-key': 'test-key' },
    });
    const capabilitiesAuthorized = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
      headers: { 'x-api-key': 'test-key' },
    });

    expect(health.statusCode).toBe(200);
    expect(readyUnauthorized.statusCode).toBe(401);
    expect(metricsUnauthorized.statusCode).toBe(401);
    expect(capabilitiesUnauthorized.statusCode).toBe(401);
    expect(readyAuthorized.statusCode).toBe(200);
    expect(metricsAuthorized.statusCode).toBe(200);
    expect(capabilitiesAuthorized.statusCode).toBe(200);
    expect(health.headers['x-request-id']).toBeDefined();
    expect(metricsAuthorized.json().http.totalRequests).toBeGreaterThan(0);
  });

  it('returns sanitized readiness errors when chain checks fail', async () => {
    app = await buildTestServer({ readyCheckFails: true });

    const ready = await app.inject({
      method: 'GET',
      url: '/ready',
      headers: { 'x-api-key': 'test-key' },
    });

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
