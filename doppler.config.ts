import type { DopplerTemplateConfigV1 } from './src/core/template-config';

export const dopplerTemplateConfig = {
  version: 1,
  port: 3000,
  deploymentMode: 'local',
  defaultChainId: 84532,
  logLevel: 'info',
  readyRpcTimeoutMs: 2000,
  corsOrigins: [],
  rateLimit: {
    max: 100,
    timeWindowMs: 60_000,
  },
  redis: {
    keyPrefix: 'doppler-api',
  },
  idempotency: {
    enabled: true,
    backend: 'file',
    requireKey: false,
    ttlMs: 86_400_000,
    storePath: '.data/idempotency-store.json',
    redisLockTtlMs: 900_000,
    redisLockRefreshMs: 300_000,
  },
  pricing: {
    enabled: true,
    provider: 'coingecko',
    baseUrl: 'https://api.coingecko.com/api/v3',
    timeoutMs: 3000,
    cacheTtlMs: 15_000,
    coingeckoAssetId: 'ethereum',
  },
  chains: {
    84532: {
      rpcUrl: 'https://base-sepolia-rpc.publicnode.com',
      defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
      auctionTypes: ['multicurve'],
      migrationModes: ['noOp'],
      governanceModes: ['noOp', 'default'],
      governanceEnabled: true,
    },
  },
} satisfies DopplerTemplateConfigV1;
