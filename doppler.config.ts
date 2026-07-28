import type { DopplerTemplateConfigV1 } from './src/core/template-config';

export const dopplerTemplateConfig = {
  version: 1,
  port: 3000,
  deploymentMode: 'standalone',
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
    1: {
      rpcEnvVar: 'ETHEREUM_RPC_URL',
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
    143: {
      rpcEnvVar: 'MONAD_RPC_URL',
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
    4663: {
      rpcEnvVar: 'ROBINHOOD_RPC_URL',
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
    8453: {
      rpcEnvVar: 'BASE_RPC_URL',
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
    84532: {
      rpcEnvVar: 'BASE_SEPOLIA_RPC_URL',
      defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
  },
} satisfies DopplerTemplateConfigV1;
