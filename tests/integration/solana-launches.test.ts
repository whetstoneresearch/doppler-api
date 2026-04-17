import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

describe('Solana create routes', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('creates a Solana launch on the dedicated route and normalizes short network aliases', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        network: 'devnet',
        tokenMetadata: { name: 'Solana Token', symbol: 'SOLT', tokenURI: 'ipfs://solana-token' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.network).toBe('solanaDevnet');
    expect(body.launchId).not.toContain(':');
    expect(body.signature).toBeDefined();
    expect(body.statusUrl).toBeUndefined();
    expect(body.predicted.launchAuthorityAddress).toBeDefined();
  });

  it('defaults the dedicated Solana route network from server config when omitted', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        tokenMetadata: { name: 'Default Network', symbol: 'DNET', tokenURI: 'ipfs://default' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().network).toBe('solanaDevnet');
  });

  it('accepts Solana payloads on the generic route only with canonical prefixed networks', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Generic Solana', symbol: 'GSOL', tokenURI: 'ipfs://gsol' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
          curveFeeBps: 25,
          allowBuy: true,
          allowSell: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.network).toBe('solanaDevnet');
    expect(body.effectiveConfig.curveFeeBps).toBe(25);
    expect(body.effectiveConfig.allowSell).toBe(false);
  });

  it('rejects short Solana network aliases on the generic route', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        network: 'devnet',
        tokenMetadata: { name: 'Wrong Generic', symbol: 'WGEN', tokenURI: 'ipfs://wrong' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        message:
          'Solana requests on POST /v1/launches must use network "solanaDevnet" or "solanaMainnetBeta"',
      },
    });
  });

  it('rejects unsupported Solana-only payload fields instead of ignoring them', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        tokenMetadata: { name: 'Strict Token', symbol: 'STRICT', tokenURI: 'ipfs://strict' },
        economics: {
          totalSupply: '1000',
          tokensForSale: '500',
        },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('maps Solana metadata validation failures to SOLANA_INVALID_METADATA', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        tokenMetadata: {
          name: 'a'.repeat(33),
          symbol: 'META',
          tokenURI: 'ipfs://metadata',
        },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SOLANA_INVALID_METADATA');
  });

  it('maps Solana curve validation failures to SOLANA_INVALID_CURVE', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        tokenMetadata: { name: 'Curve Token', symbol: 'CURVE', tokenURI: 'ipfs://curve' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 1000,
            marketCapEndUsd: 100,
          },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SOLANA_INVALID_CURVE');
  });

  it('replays Solana create requests when the idempotency key and payload match', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const payload = {
      network: 'solanaDevnet',
      tokenMetadata: { name: 'Replay Token', symbol: 'RPLY', tokenURI: 'ipfs://replay' },
      economics: { totalSupply: '1000' },
      governance: false,
      migration: { type: 'noOp' as const },
      auction: {
        type: 'xyk' as const,
        curveConfig: {
          type: 'range' as const,
          marketCapStartUsd: 100,
          marketCapEndUsd: 1000,
        },
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
        'idempotency-key': 'solana-replay-key',
      },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
        'idempotency-key': 'solana-replay-key',
      },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-idempotency-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
  });

  it('rejects reuse of a Solana idempotency key with a different payload', async () => {
    app = await buildTestServer({ solanaEnabled: true });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
        'idempotency-key': 'solana-mismatch-key',
      },
      payload: {
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Mismatch A', symbol: 'MSHA', tokenURI: 'ipfs://a' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
        'idempotency-key': 'solana-mismatch-key',
      },
      payload: {
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Mismatch B', symbol: 'MSHB', tokenURI: 'ipfs://b' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        message: 'Idempotency-Key was already used with a different request payload',
      },
    });
  });

  it('surfaces SOLANA_NOT_READY on create', async () => {
    app = await buildTestServer({
      solanaEnabled: true,
      solanaCreateError: {
        statusCode: 503,
        code: 'SOLANA_NOT_READY',
        message: 'Solana devnet is not ready for launch creation',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/solana/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        tokenMetadata: { name: 'Not Ready', symbol: 'NORD', tokenURI: 'ipfs://not-ready' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: 'SOLANA_NOT_READY',
        message: 'Internal server error',
      },
    });
  });

  it('surfaces Solana simulation and submission failures with stable codes', async () => {
    for (const errorCase of [
      {
        code: 'SOLANA_SIMULATION_FAILED',
        statusCode: 422,
      },
      {
        code: 'SOLANA_SUBMISSION_FAILED',
        statusCode: 502,
      },
    ]) {
      app = await buildTestServer({
        solanaEnabled: true,
        solanaCreateError: {
          statusCode: errorCase.statusCode,
          code: errorCase.code,
          message: `${errorCase.code} message`,
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/solana/launches',
        headers: {
          'x-api-key': 'test-key',
        },
        payload: {
          tokenMetadata: { name: 'Failed Launch', symbol: 'FAIL', tokenURI: 'ipfs://fail' },
          economics: { totalSupply: '1000' },
          governance: false,
          migration: { type: 'noOp' },
          auction: {
            type: 'xyk',
            curveConfig: {
              type: 'range',
              marketCapStartUsd: 100,
              marketCapEndUsd: 1000,
            },
          },
        },
      });

      expect(response.statusCode).toBe(errorCase.statusCode);
      expect(response.json().error.code).toBe(errorCase.code);

      await app.close();
      app = null;
    }
  });

  it('includes launch details when Solana confirmation is in doubt', async () => {
    app = await buildTestServer({
      solanaEnabled: true,
      solanaCreateError: {
        statusCode: 409,
        code: 'SOLANA_LAUNCH_IN_DOUBT',
        message: 'Solana launch confirmation is in doubt',
        details: {
          launchId: '8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP',
          signature:
            '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
          explorerUrl:
            'https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet',
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        network: 'solanaDevnet',
        tokenMetadata: { name: 'In Doubt', symbol: 'DOUBT', tokenURI: 'ipfs://doubt' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'SOLANA_LAUNCH_IN_DOUBT',
        message: 'Solana launch confirmation is in doubt',
        details: {
          launchId: '8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP',
          signature:
            '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
          explorerUrl:
            'https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet',
        },
      },
    });
  });
});
