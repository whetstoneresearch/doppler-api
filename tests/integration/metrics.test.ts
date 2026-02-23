import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

describe('GET /metrics', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns metrics snapshot with request counters', async () => {
    app = await buildTestServer();

    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/ready' });
    const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });

    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.headers['x-request-id']).toBeDefined();

    const body = metricsResponse.json();
    expect(body.startedAt).toBeTypeOf('string');
    expect(body.uptimeSec).toBeTypeOf('number');
    expect(body.http.totalRequests).toBeGreaterThanOrEqual(2);
    expect(body.http.byStatusClass['2xx']).toBeGreaterThanOrEqual(2);
    expect(body.http.avgDurationMs).toBeGreaterThanOrEqual(0);
  });
});
