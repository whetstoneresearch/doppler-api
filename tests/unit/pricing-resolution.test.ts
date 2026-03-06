import { describe, expect, it } from 'vitest';

import { PricingService } from '../../src/modules/pricing/service';
import type { AppConfig } from '../../src/core/config';

const baseConfig: AppConfig = {
  port: 3000,
  deploymentMode: 'local',
  apiKey: 'test',
  apiKeys: ['test'],
  defaultChainId: 84532,
  privateKey: '0x59c6995e998f97a5a0044966f0945386f3f6f3d1063f4042afe30de8f34a4c9e',
  logLevel: 'info',
  readyRpcTimeoutMs: 2000,
  corsOrigins: [],
  rateLimit: {
    max: 100,
    timeWindowMs: 60_000,
  },
  redis: {
    keyPrefix: 'doppler-api-test',
  },
  idempotency: {
    enabled: true,
    backend: 'file',
    requireKey: false,
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
  },
};

describe('pricing resolution', () => {
  it('uses override when provided', async () => {
    const service = new PricingService(baseConfig);

    const price = await service.resolveNumerairePriceUsd({
      chainId: 84532,
      numeraireAddress: '0x4200000000000000000000000000000000000006',
      defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
      overrideUsd: 1234,
    });

    expect(price).toBe(1234);
  });

  it('throws when provider disabled and no override', async () => {
    const service = new PricingService(baseConfig);

    await expect(
      service.resolveNumerairePriceUsd({
        chainId: 84532,
        numeraireAddress: '0x4200000000000000000000000000000000000006',
        defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
      }),
    ).rejects.toThrow(/Auto pricing is disabled/);
  });
});
