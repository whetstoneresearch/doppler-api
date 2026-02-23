import { afterEach, describe, expect, it } from 'vitest';

import { buildServer, type AppServices } from '../../src/app/server';
import type { AppConfig } from '../../src/core/config';
import { MetricsRegistry } from '../../src/core/metrics';

describe('GET /v1/capabilities', () => {
  let app: Awaited<ReturnType<typeof buildServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns per-chain capability matrix', async () => {
    const config: AppConfig = {
      port: 3000,
      apiKey: 'test-key',
      apiKeys: ['test-key'],
      defaultChainId: 84532,
      privateKey: '0x59c6995e998f97a5a0044966f0945386f3f6f3d1063f4042afe30de8f34a4c9e',
      logLevel: 'silent',
      readyRpcTimeoutMs: 1000,
      corsOrigins: [],
      rateLimit: {
        max: 100,
        timeWindowMs: 60_000,
      },
      idempotency: {
        enabled: true,
        requireKey: false,
        ttlMs: 86_400_000,
        storePath: '.test-results/test-idempotency.json',
      },
      pricing: {
        enabled: true,
        provider: 'coingecko',
        baseUrl: 'https://api.coingecko.com/api/v3',
        timeoutMs: 1000,
        cacheTtlMs: 1000,
      },
      chains: {
        84532: {
          chainId: 84532,
          rpcUrl: 'http://localhost:8545',
          defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
          auctionTypes: ['multicurve'],
          migrationModes: ['noOp'],
          governanceModes: ['noOp'],
          governanceEnabled: false,
        },
        8453: {
          chainId: 8453,
          rpcUrl: 'http://localhost:8545',
          defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
          auctionTypes: ['multicurve'],
          migrationModes: ['noOp', 'uniswapV2'],
          governanceModes: ['noOp', 'default'],
          governanceEnabled: true,
        },
      },
    };

    const fakeChainA = {
      chainId: 84532,
      config: config.chains[84532],
      publicClient: { getBlockNumber: async () => 1n },
      walletClient: {},
      addresses: { airlock: '0x0000000000000000000000000000000000000001' },
    } as any;
    const fakeChainB = {
      chainId: 8453,
      config: config.chains[8453],
      publicClient: { getBlockNumber: async () => 1n },
      walletClient: {},
      addresses: { airlock: '0x0000000000000000000000000000000000000001' },
    } as any;

    const services: AppServices = {
      config,
      metrics: new MetricsRegistry(),
      chainRegistry: {
        defaultChainId: 84532,
        get: (chainId?: number) => (chainId === 8453 ? fakeChainB : fakeChainA),
        list: () => [fakeChainA, fakeChainB],
      } as any,
      sdkRegistry: {} as any,
      txSubmitter: {} as any,
      idempotencyStore: {
        execute: async (_key: string, _payload: unknown, action: () => Promise<unknown>) => ({
          response: await action(),
          replayed: false,
        }),
      } as any,
      pricingService: {
        isEnabled: () => true,
        getProviderName: () => 'coingecko',
      } as any,
      launchService: {
        createLaunch: async () => {
          throw new Error('not used');
        },
      } as any,
      statusService: {
        getLaunchStatus: async () => {
          throw new Error('not used');
        },
      } as any,
    };

    app = await buildServer(services);

    const response = await app.inject({ method: 'GET', url: '/v1/capabilities' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      chains: Array<{
        chainId: number;
        governanceEnabled: boolean;
        governanceModes: string[];
        multicurveInitializers: string[];
      }>;
      pricing: { provider: string };
    };
    expect(body.chains).toHaveLength(2);
    expect(body.pricing.provider).toBe('coingecko');
    const byChain = new Map(body.chains.map((chain) => [chain.chainId, chain]));
    expect(byChain.get(84532)?.governanceEnabled).toBe(false);
    expect(byChain.get(84532)?.governanceModes).toEqual(['noOp']);
    expect(byChain.get(84532)?.multicurveInitializers).toEqual(['standard']);
    expect(byChain.get(8453)?.governanceEnabled).toBe(false);
    expect(byChain.get(8453)?.governanceModes).toEqual(['noOp']);
    expect(byChain.get(8453)?.multicurveInitializers).toEqual(['standard']);
  });
});
