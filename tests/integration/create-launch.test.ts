import { afterEach, describe, expect, it } from 'vitest';

import { buildTestServer } from './test-server';

const REHYPE_FEE_DISTRIBUTION_INFO = {
  assetFeesToAssetBuybackWad: '500000000000000000',
  assetFeesToNumeraireBuybackWad: '500000000000000000',
  assetFeesToBeneficiaryWad: '0',
  assetFeesToLpWad: '0',
  numeraireFeesToAssetBuybackWad: '500000000000000000',
  numeraireFeesToNumeraireBuybackWad: '500000000000000000',
  numeraireFeesToBeneficiaryWad: '0',
  numeraireFeesToLpWad: '0',
} as const;

const REHYPE_BUYBACK_INITIALIZER = {
  buybackDestination: '0x000000000000000000000000000000000000dEaD',
  startFee: 30_000,
  feeDistributionInfo: REHYPE_FEE_DISTRIBUTION_INFO,
} as const;

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
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.launchId).toContain('84532:0x');
    expect(body.effectiveConfig.tokensForSale).toBe('1000');
    expect(body.effectiveConfig.allocationAmount).toBe('0');
    expect(body.effectiveConfig.vestingAllocations).toEqual([]);
    expect(body.effectiveConfig.poolFeeBeneficiariesSource).toBe('default');
  });

  it('requires chainId when no default chain is configured', async () => {
    app = await buildTestServer({ defaultChainId: null });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CHAIN_ID_REQUIRED');
  });

  it('uses an explicit configured chain when no default chain is configured', async () => {
    app = await buildTestServer({ defaultChainId: null });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        chainId: 84532,
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chainId).toBe(84532);
  });

  it('rejects an explicit chain without a configured RPC', async () => {
    app = await buildTestServer({ defaultChainId: null });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        chainId: 8453,
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CHAIN_NOT_CONFIGURED');
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
        economics: { totalSupply: '1000' },
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
        economics: { totalSupply: '1000' },
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

  it('dynamic launch: explicit range starts at $100 and uses uniswapV2 migration', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Dynamic Token', symbol: 'DYN', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'uniswapV2' },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 50,
            minProceeds: '0.01',
            maxProceeds: '0.1',
            durationSeconds: 86_400,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.launchId).toContain('84532:0x');
    expect(body.effectiveConfig.tokensForSale).toBe('1000');
  });

  it('dynamic launch: supports uniswapV4 config', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: {
          name: 'Dynamic Hook Migration Token',
          symbol: 'DHM',
          tokenURI: 'ipfs://token',
        },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: {
          type: 'uniswapV4',
          fee: 20_000,
          tickSpacing: 100,
          lockDurationSeconds: 86_400,
        },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 50,
            minProceeds: '0.01',
            maxProceeds: '0.1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('static launch alias: /v1/launches/static', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/static',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Static Alias Token', symbol: 'SAT', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
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
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('dynamic launch alias: /v1/launches/dynamic', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/dynamic',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Dynamic Alias Token', symbol: 'DAT', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'uniswapV2' },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 50,
            minProceeds: '0.01',
            maxProceeds: '0.1',
            durationSeconds: 86_400,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('static alias rejects non-static auction payloads', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/static',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Wrong Alias Token', symbol: 'WAT', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('dynamic alias rejects non-dynamic auction payloads', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/dynamic',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Wrong Dynamic Alias', symbol: 'WDA', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('multicurve alias rejects non-multicurve auction payloads', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/multicurve',
      headers: { 'x-api-key': 'test-key' },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Wrong Multicurve Alias', symbol: 'WMA', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'static',
          curveConfig: { type: 'preset', preset: 'low' },
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('returns 422 for malformed WAD strings without throwing', async () => {
    app = await buildTestServer();
    const basePayload = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Malformed WAD', symbol: 'MWAD', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
    };
    const feeDistributionInfo = {
      assetFeesToAssetBuybackWad: '1000000000000000000',
      assetFeesToNumeraireBuybackWad: '0',
      assetFeesToBeneficiaryWad: '0',
      assetFeesToLpWad: '0',
      numeraireFeesToAssetBuybackWad: '1000000000000000000',
      numeraireFeesToNumeraireBuybackWad: '0',
      numeraireFeesToBeneficiaryWad: '0',
      numeraireFeesToLpWad: '0',
    };
    const requests = [
      {
        url: '/v1/launches/static',
        payload: {
          ...basePayload,
          auction: {
            type: 'static',
            curveConfig: {
              type: 'preset',
              preset: 'low',
              maxShareToBeSoldWad: 'not-an-integer',
            },
          },
        },
      },
      {
        url: '/v1/launches/multicurve',
        payload: {
          ...basePayload,
          auction: {
            type: 'multicurve',
            curveConfig: { type: 'preset' },
            initializer: {
              rehypeFeeBeneficiaries: [
                {
                  address: '0x2222222222222222222222222222222222222222',
                  sharesWad: 'not-an-integer',
                },
              ],
              startFee: 1,
              feeDistributionInfo,
            },
          },
        },
      },
    ];

    for (const { url, payload } of requests) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: { 'x-api-key': 'test-key' },
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_REQUEST');
    }
  });

  it('retains the replay header on a canonical alias request', async () => {
    app = await buildTestServer();
    const payload = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Replay Token', symbol: 'RPL', tokenURI: 'ipfs://replay' },
      economics: { totalSupply: '1000' },
      auction: {
        type: 'static',
        curveConfig: { type: 'preset', preset: 'low' },
      },
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/launches/static',
      headers: { 'x-api-key': 'test-key', 'idempotency-key': 'canonical-static' },
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/launches/static',
      headers: { 'x-api-key': 'test-key', 'idempotency-key': 'canonical-static' },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers['x-idempotency-replayed']).toBeUndefined();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('true');
  });

  it('replays a legacy create body before current request validation', async () => {
    const payload = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Legacy Token', symbol: 'LEG', tokenURI: 'ipfs://legacy' },
      economics: { totalSupply: '1000' },
      governance: { enabled: false, mode: 'noOp' },
      migration: { type: 'noOp' },
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset' },
      },
    };
    app = await buildTestServer({
      legacyIdempotencyRecord: {
        key: 'previously-used-key',
        payload,
      },
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: { 'x-api-key': 'test-key', 'idempotency-key': 'previously-used-key' },
      payload,
    });
    const newRequest = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: { 'x-api-key': 'test-key', 'idempotency-key': 'new-key' },
      payload,
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('true');
    expect(newRequest.statusCode).toBe(422);
    expect(newRequest.json().error.code).toBe('INVALID_REQUEST');
    expect(newRequest.headers['x-idempotency-replayed']).toBeUndefined();
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
        economics: { totalSupply: '1000', tokensForSale: '200' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('200');
    expect(body.effectiveConfig.allocationAmount).toBe('800');
    expect(body.effectiveConfig.vestingAllocations).toEqual([
      {
        recipientAddress: '0x1111111111111111111111111111111111111111',
        amount: '800',
        durationSeconds: 90 * 24 * 60 * 60,
        cliffDurationSeconds: 0,
      },
    ]);
  });

  it('respects an explicit vesting schedule', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Vested Token', symbol: 'VST', tokenURI: 'ipfs://vesting' },
        economics: {
          totalSupply: '1000',
          tokensForSale: '400',
          allocations: [
            {
              recipientAddress: '0x2222222222222222222222222222222222222222',
              amount: '600',
              durationSeconds: 86_400,
              cliffDurationSeconds: 3_600,
            },
          ],
        },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['high'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('400');
    expect(body.effectiveConfig.allocationAmount).toBe('600');
    expect(body.effectiveConfig.vestingAllocations).toEqual([
      {
        recipientAddress: '0x2222222222222222222222222222222222222222',
        amount: '600',
        durationSeconds: 86_400,
        cliffDurationSeconds: 3_600,
      },
    ]);
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
        economics: {
          totalSupply: '1000',
          allocations: [
            {
              recipientAddress: '0x2222222222222222222222222222222222222222',
              amount: '300',
              durationSeconds: 86_400,
            },
            {
              recipientAddress: '0x3333333333333333333333333333333333333333',
              amount: '200',
              durationSeconds: 172_800,
              cliffDurationSeconds: 86_400,
            },
          ],
        },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.effectiveConfig.tokensForSale).toBe('500');
    expect(body.effectiveConfig.allocationAmount).toBe('500');
    expect(body.effectiveConfig.vestingAllocations).toEqual([
      {
        recipientAddress: '0x2222222222222222222222222222222222222222',
        amount: '300',
        durationSeconds: 86_400,
        cliffDurationSeconds: 0,
      },
      {
        recipientAddress: '0x3333333333333333333333333333333333333333',
        amount: '200',
        durationSeconds: 172_800,
        cliffDurationSeconds: 86_400,
      },
    ]);
  });

  it('preserves a flattened Rehype initializer through the multicurve alias', async () => {
    app = await buildTestServer();

    const basePayload = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Init Token', symbol: 'INI', tokenURI: 'ipfs://init' },
      economics: {
        totalSupply: '1000',
        tokensForSale: '800',
      },
      governance: false,
      auction: {
        type: 'multicurve' as const,
        curveConfig: { type: 'preset' as const, presets: ['medium' as const], fee: 10_000 },
        initializer: REHYPE_BUYBACK_INITIALIZER,
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches/multicurve',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: basePayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().effectiveConfig.initializer).toEqual(REHYPE_BUYBACK_INITIALIZER);
  });

  it('accepts governance=true for multicurve launches', async () => {
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
        economics: { totalSupply: '1000' },
        governance: true,
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('accepts governance=true for static launches', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Governed Static Token', symbol: 'GST', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        governance: true,
        auction: {
          type: 'static',
          curveConfig: { type: 'preset', preset: 'medium' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('accepts governance=true for dynamic launches', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      headers: {
        'x-api-key': 'test-key',
      },
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: {
          name: 'Governed Dynamic Token',
          symbol: 'GDT',
          tokenURI: 'ipfs://token',
        },
        economics: { totalSupply: '1000' },
        governance: true,
        migration: { type: 'uniswapV2' },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 50,
            minProceeds: '0.01',
            maxProceeds: '0.1',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().launchId).toContain('84532:0x');
  });

  it('rejects request without API key', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/launches',
      payload: {
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['low'] },
          initializer: REHYPE_BUYBACK_INITIALIZER,
        },
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
