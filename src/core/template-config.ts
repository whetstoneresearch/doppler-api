import type { AuctionType, GovernanceMode, MigrationType } from './types';

export type DeploymentMode = 'local' | 'shared';
export type IdempotencyBackend = 'file' | 'redis';
export type PriceProvider = 'coingecko' | 'none';

export interface DopplerTemplateChainConfigV1 {
  rpcUrl: string;
  defaultNumeraireAddress?: `0x${string}`;
  auctionTypes: AuctionType[];
  migrationModes: MigrationType[];
  governanceModes: GovernanceMode[];
  governanceEnabled: boolean;
}

export interface DopplerTemplateConfigV1 {
  version: 1;
  port: number;
  deploymentMode: DeploymentMode;
  defaultChainId: number;
  logLevel: string;
  readyRpcTimeoutMs: number;
  corsOrigins: string[];
  rateLimit: {
    max: number;
    timeWindowMs: number;
  };
  redis: {
    keyPrefix: string;
  };
  idempotency: {
    enabled: boolean;
    backend: IdempotencyBackend;
    requireKey: boolean;
    ttlMs: number;
    storePath: string;
    redisLockTtlMs: number;
    redisLockRefreshMs: number;
  };
  pricing: {
    enabled: boolean;
    provider: PriceProvider;
    baseUrl: string;
    timeoutMs: number;
    cacheTtlMs: number;
    coingeckoAssetId: string;
  };
  chains: Record<number, DopplerTemplateChainConfigV1>;
}
