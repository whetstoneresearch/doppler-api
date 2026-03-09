import { afterEach, describe, expect, it } from 'vitest';

import { AppError } from '../../src/core/errors';
import { buildTestServer } from './test-server';

describe('error handler', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns 429 envelope when rate limit is exceeded', async () => {
    app = await buildTestServer();

    for (let index = 0; index < 100; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: 'GET', url: '/health' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded, retry in 1 minute',
      },
    });
  });

  it('does not allow spoofed x-api-key rotation to bypass public route limits', async () => {
    app = await buildTestServer();

    for (let index = 0; index < 100; index += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-api-key': `spoofed-${index}`,
        },
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-api-key': 'spoofed-over-limit',
      },
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded, retry in 1 minute',
      },
    });
  });

  it('returns generic client message for unhandled server errors', async () => {
    app = await buildTestServer();

    app.get('/_test/unhandled-error', { config: { auth: false } }, async () => {
      throw new Error('sensitive upstream details should never leak');
    });

    const response = await app.inject({ method: 'GET', url: '/_test/unhandled-error' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  });

  it('keeps server code but hides message/details for AppError 5xx responses', async () => {
    app = await buildTestServer();

    app.get('/_test/upstream-error', { config: { auth: false } }, async () => {
      throw new AppError(502, 'CHAIN_LOOKUP_FAILED', 'Failed to fetch transaction receipt', {
        reason: 'rpc timeout',
      });
    });

    const response = await app.inject({ method: 'GET', url: '/_test/upstream-error' });
    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error.code).toBe('CHAIN_LOOKUP_FAILED');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.details).toBeUndefined();
  });
});
