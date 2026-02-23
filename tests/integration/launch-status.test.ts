import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

describe('GET /v1/launches/:launchId', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns launch status', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headers: {
        'x-api-key': 'test-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('pending');
  });
});
