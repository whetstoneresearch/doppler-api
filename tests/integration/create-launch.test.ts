import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

describe('POST /v1/launches', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('creates launch with valid request and API key', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '1000' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.launchId).toContain('84532:0x');
    expect(body.effectiveConfig.tokensForSale).toBe('1000');
    expect(body.effectiveConfig.allocationAmount).toBe('0');
    expect(body.effectiveConfig.allocationLockMode).toBe('none');
  });

  it('static launch: low market cap preset', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Static Token', symbol: 'STK', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '1000' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'static',
          curveConfig: {
            type: 'preset',
            preset: 'low',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.launchId).toContain('84532:0x');
    expect(body.effectiveConfig.tokensForSale).toBe('1000');
  });

  it('static launch: explicit range starts at $100', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Static Range Token', symbol: 'SRT', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '1000' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'static',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 100000,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.launchId).toContain('84532:0x');
    expect(body.effectiveConfig.tokensForSale).toBe('1000');
  });

  it('returns allocation defaults when sale is less than total supply', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Split Token', symbol: 'SPL', tokenURI: 'ipfs://split' },
        tokenomics: { totalSupply: '1000', tokensForSale: '200' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('200');
    expect(body.effectiveConfig.allocationAmount).toBe('800');
    expect(body.effectiveConfig.allocationRecipient).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(body.effectiveConfig.allocationLockMode).toBe('vest');
    expect(body.effectiveConfig.allocationLockDurationSeconds).toBe(90 * 24 * 60 * 60);
  });

  it('respects explicit allocation lock config', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Unlocked Token', symbol: 'ULK', tokenURI: 'ipfs://unlock' },
        tokenomics: {
          totalSupply: '1000',
          tokensForSale: '400',
          allocations: {
            recipientAddress: '0x2222222222222222222222222222222222222222',
            mode: 'unlock',
            durationSeconds: 0,
          },
        },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['high'] },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('400');
    expect(body.effectiveConfig.allocationAmount).toBe('600');
    expect(body.effectiveConfig.allocationRecipient).toBe(
      '0x2222222222222222222222222222222222222222',
    );
    expect(body.effectiveConfig.allocationLockMode).toBe('unlock');
    expect(body.effectiveConfig.allocationLockDurationSeconds).toBe(0);
  });

  it('supports explicit multi-address allocations', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Team Split Token', symbol: 'TST', tokenURI: 'ipfs://split' },
        tokenomics: {
          totalSupply: '1000',
          allocations: {
            mode: 'vest',
            allocations: [
              { address: '0x2222222222222222222222222222222222222222', amount: '300' },
              { address: '0x3333333333333333333333333333333333333333', amount: '200' },
            ],
          },
        },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('500');
    expect(body.effectiveConfig.allocationAmount).toBe('500');
    expect(body.effectiveConfig.allocationRecipient).toBe(
      '0x2222222222222222222222222222222222222222',
    );
    expect(body.effectiveConfig.allocationRecipients).toEqual([
      { address: '0x2222222222222222222222222222222222222222', amount: '300' },
      { address: '0x3333333333333333333333333333333333333333', amount: '200' },
    ]);
  });

  it('accepts scheduled, decay, and rehype initializers', async () => {
    app = await buildTestServer();

    const basePayload = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Init Token', symbol: 'INI', tokenURI: 'ipfs://init' },
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '800',
      },
      governance: { enabled: false, mode: 'noOp' as const },
      migration: { type: 'noOp' as const },
      auction: {
        type: 'multicurve' as const,
        curveConfig: { type: 'preset' as const, presets: ['medium' as const], fee: 10_000 },
      },
    };

    const payloads = [
      {
        ...basePayload,
        auction: {
          ...basePayload.auction,
          initializer: {
            type: 'scheduled' as const,
            startTime: 1_735_689_600,
          },
        },
      },
      {
        ...basePayload,
        auction: {
          ...basePayload.auction,
          initializer: {
            type: 'decay' as const,
            startFee: 400_000,
            durationSeconds: 45,
            startTime: 1_735_689_600,
          },
        },
      },
      {
        ...basePayload,
        auction: {
          ...basePayload.auction,
          initializer: {
            type: 'rehype' as const,
            config: {
              hookAddress: '0x2222222222222222222222222222222222222222',
              buybackDestination: '0x000000000000000000000000000000000000dEaD',
              customFee: 30_000,
              assetBuybackPercentWad: '500000000000000000',
              numeraireBuybackPercentWad: '500000000000000000',
              beneficiaryPercentWad: '0',
              lpPercentWad: '0',
            },
          },
        },
      },
    ];

    for (const payload of payloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/launches',
        headers: {
          'x-api-key': 'test-key',
        },
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('rejects governance=true as not implemented', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Governed Token', symbol: 'GOV', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '1000' },
        governance: true,
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
        },
      },
    });

    expect(response.statusCode).toBe(501);
    expect(response.json().error.code).toBe('GOVERNANCE_NOT_IMPLEMENTED');
  });

  it('rejects request without API key', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '1000' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
        },
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
