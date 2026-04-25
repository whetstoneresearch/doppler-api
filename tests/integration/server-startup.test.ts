import { describe, expect, it } from 'vitest';

import { buildServer, type AppServices } from '../../src/app/server';
import type { AppConfig } from '../../src/core/config';
import { MetricsRegistry } from '../../src/core/metrics';

describe('server startup', () => {
  it('fails fast in shared mode when redis is unreachable', async () => {
    const config: AppConfig = {
      port: 3000,
      deploymentMode: 'shared',
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
      redis: {
        url: 'redis://127.0.0.1:6379',
        keyPrefix: 'doppler-api-test',
      },
      idempotency: {
        enabled: true,
        backend: 'redis',
        requireKey: true,
        ttlMs: 86_400_000,
        storePath: '.test-results/test-idempotency.json',
        redisLockTtlMs: 900_000,
        redisLockRefreshMs: 300_000,
      },
      pricing: {
        enabled: false,
        provider: 'none',
        baseUrl: 'https://api.coingecko.com/api/v3',
        timeoutMs: 1000,
        cacheTtlMs: 1000,
        coingeckoAssetId: 'ethereum',
      },
      solana: {
        enabled: false,
        defaultNetwork: 'solanaDevnet',
        devnetRpcUrl: 'http://127.0.0.1:8899',
        devnetWsUrl: 'ws://127.0.0.1:8900',
        confirmTimeoutMs: 60_000,
        priceMode: 'required',
        coingeckoAssetId: 'solana',
      },
      chains: {
        84532: {
          chainId: 84532,
          rpcUrl: 'http://localhost:8545',
          defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
          auctionTypes: ['multicurve'],
          migrationModes: ['noOp'],
          governanceModes: ['noOp', 'default'],
          governanceEnabled: true,
        },
      },
    };

    const fakeChain = {
      chainId: 84532,
      config: config.chains[84532],
      addresses: { airlock: '0x0000000000000000000000000000000000000001' },
      publicClient: {
        getBlockNumber: async () => 123n,
      },
      walletClient: {},
    } as any;

    const services: AppServices = {
      config,
      metrics: new MetricsRegistry(),
      chainRegistry: {
        defaultChainId: 84532,
        get: () => fakeChain,
        list: () => [fakeChain],
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
        isEnabled: () => false,
        getProviderName: () => 'none',
      } as any,
      solanaLaunchService: {
        getReadiness: async () => ({ enabled: false, ok: true, checks: [] }),
        createLaunch: async () => {
          throw new Error('not used');
        },
      } as any,
      launchService: {
        createLaunch: async () => {
          throw new Error('not used');
        },
        createLaunchWithIdempotency: async () => {
          throw new Error('not used');
        },
      } as any,
      statusService: {
        getLaunchStatus: async () => {
          throw new Error('not used');
        },
      } as any,
      redisClient: {
        ping: async () => {
          throw new Error('ECONNREFUSED');
        },
        quit: async () => 'OK',
        disconnect: () => undefined,
      } as any,
    };

    await expect(buildServer(services)).rejects.toMatchObject({
      statusCode: 500,
      code: 'REDIS_UNAVAILABLE',
    });
  });
});
