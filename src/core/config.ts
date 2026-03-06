import 'dotenv/config';

import { z } from 'zod';

import { AppError } from './errors';
import type { AuctionType, GovernanceMode, MigrationType } from './types';

const DEFAULT_AUCTION_TYPES: AuctionType[] = ['multicurve'];
const DEFAULT_MIGRATION_TYPES: MigrationType[] = ['noOp'];
const DEFAULT_GOVERNANCE_MODES: GovernanceMode[] = ['noOp', 'default'];

export type DeploymentMode = 'local' | 'shared';
export type IdempotencyBackend = 'file' | 'redis';

export interface ChainRuntimeConfig {
  chainId: number;
  rpcUrl: string;
  defaultNumeraireAddress?: `0x${string}`;
  auctionTypes: AuctionType[];
  migrationModes: MigrationType[];
  governanceModes: GovernanceMode[];
  governanceEnabled: boolean;
}

export interface AppConfig {
  port: number;
  deploymentMode: DeploymentMode;
  apiKey: string;
  apiKeys: string[];
  defaultChainId: number;
  chains: Record<number, ChainRuntimeConfig>;
  privateKey: `0x${string}`;
  logLevel: string;
  readyRpcTimeoutMs: number;
  corsOrigins: string[];
  rateLimit: {
    max: number;
    timeWindowMs: number;
  };
  redis: {
    url?: string;
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
    provider: 'coingecko' | 'none';
    baseUrl: string;
    timeoutMs: number;
    cacheTtlMs: number;
    apiKey?: string;
  };
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseStringArray = (value: string | undefined): string[] => {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseDeploymentMode = (): DeploymentMode => {
  const raw = process.env.DEPLOYMENT_MODE?.trim().toLowerCase();
  if (!raw) {
    return process.env.NODE_ENV?.trim().toLowerCase() === 'production' ? 'shared' : 'local';
  }

  if (raw === 'local' || raw === 'shared') {
    return raw;
  }

  throw new AppError(500, 'INVALID_ENV', 'DEPLOYMENT_MODE must be "local" or "shared"');
};

const parseIdempotencyBackend = (): IdempotencyBackend => {
  const raw = process.env.IDEMPOTENCY_BACKEND?.trim().toLowerCase() || 'file';
  if (raw === 'file' || raw === 'redis') {
    return raw;
  }

  throw new AppError(500, 'INVALID_ENV', 'IDEMPOTENCY_BACKEND must be "file" or "redis"');
};

const chainConfigSchema = z.object({
  rpcUrl: z.string().min(1),
  defaultNumeraireAddress: z.string().startsWith('0x').optional(),
  auctionTypes: z.array(z.enum(['multicurve', 'static', 'dynamic'])).optional(),
  migrationModes: z.array(z.enum(['noOp', 'uniswapV2', 'uniswapV3', 'uniswapV4'])).optional(),
  governanceModes: z.array(z.enum(['noOp', 'default', 'custom'])).optional(),
  governanceEnabled: z.boolean().optional(),
});

const chainConfigMapSchema = z.record(chainConfigSchema);

const parseChainConfigJson = (): Record<number, ChainRuntimeConfig> => {
  const raw = process.env.CHAIN_CONFIG_JSON;
  if (!raw || raw.trim() === '') {
    return {};
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new AppError(
      500,
      'INVALID_CHAIN_CONFIG_JSON',
      'CHAIN_CONFIG_JSON is not valid JSON',
      error,
    );
  }

  const parsed = chainConfigMapSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError(
      500,
      'INVALID_CHAIN_CONFIG_JSON',
      'CHAIN_CONFIG_JSON has invalid shape',
      parsed.error.flatten(),
    );
  }

  const mapped: Record<number, ChainRuntimeConfig> = {};
  for (const [chainIdStr, value] of Object.entries(parsed.data)) {
    const chainId = Number(chainIdStr);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new AppError(
        500,
        'INVALID_CHAIN_ID',
        `Invalid chainId key in CHAIN_CONFIG_JSON: ${chainIdStr}`,
      );
    }

    const governanceModes = value.governanceModes ?? DEFAULT_GOVERNANCE_MODES;
    const governanceEnabledDefault =
      governanceModes.includes('default') || governanceModes.includes('custom');

    mapped[chainId] = {
      chainId,
      rpcUrl: value.rpcUrl,
      defaultNumeraireAddress: value.defaultNumeraireAddress as `0x${string}` | undefined,
      auctionTypes: value.auctionTypes ?? DEFAULT_AUCTION_TYPES,
      migrationModes: value.migrationModes ?? DEFAULT_MIGRATION_TYPES,
      governanceModes,
      governanceEnabled: value.governanceEnabled ?? governanceEnabledDefault,
    };
  }

  return mapped;
};

export const loadConfig = (): AppConfig => {
  const apiKey = process.env.API_KEY;
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const deploymentMode = parseDeploymentMode();
  const redisUrl = process.env.REDIS_URL?.trim() || undefined;
  const redisKeyPrefix = process.env.REDIS_KEY_PREFIX?.trim() || 'doppler-api';
  const idempotencyEnabled = parseBoolean(process.env.IDEMPOTENCY_ENABLED, true);
  const idempotencyBackend = parseIdempotencyBackend();
  const idempotencyRedisLockTtlMs = parseNumber(process.env.IDEMPOTENCY_REDIS_LOCK_TTL_MS, 900_000);
  const idempotencyRedisLockRefreshMs = parseNumber(
    process.env.IDEMPOTENCY_REDIS_LOCK_REFRESH_MS,
    Math.max(Math.floor(idempotencyRedisLockTtlMs / 3), 1_000),
  );

  if (!apiKey) {
    throw new AppError(500, 'MISSING_ENV', 'API_KEY is required');
  }
  if (!privateKey) {
    throw new AppError(500, 'MISSING_ENV', 'PRIVATE_KEY is required');
  }

  const defaultChainId = parseNumber(process.env.DEFAULT_CHAIN_ID, 84532);
  const parsedChainMap = parseChainConfigJson();

  const chains: Record<number, ChainRuntimeConfig> = { ...parsedChainMap };

  if (!chains[defaultChainId]) {
    if (!rpcUrl) {
      throw new AppError(
        500,
        'MISSING_ENV',
        `RPC_URL is required when CHAIN_CONFIG_JSON does not define default chain ${defaultChainId}`,
      );
    }

    chains[defaultChainId] = {
      chainId: defaultChainId,
      rpcUrl,
      defaultNumeraireAddress: process.env.DEFAULT_NUMERAIRE_ADDRESS as `0x${string}` | undefined,
      auctionTypes: DEFAULT_AUCTION_TYPES,
      migrationModes: DEFAULT_MIGRATION_TYPES,
      governanceModes: DEFAULT_GOVERNANCE_MODES,
      governanceEnabled: true,
    };
  }

  const pricingEnabled = parseBoolean(process.env.PRICE_ENABLED, true);
  const provider = (process.env.PRICE_PROVIDER?.trim() || 'coingecko') as 'coingecko' | 'none';
  const apiKeys = parseStringArray(process.env.API_KEYS);
  const resolvedApiKeys = [...new Set([apiKey, ...apiKeys].filter(Boolean) as string[])];
  const requireIdempotencyKey =
    deploymentMode === 'shared' ? true : parseBoolean(process.env.IDEMPOTENCY_REQUIRE_KEY, false);

  if (idempotencyBackend === 'redis' && !redisUrl) {
    throw new AppError(500, 'MISSING_ENV', 'REDIS_URL is required when IDEMPOTENCY_BACKEND=redis');
  }

  if (idempotencyRedisLockRefreshMs >= idempotencyRedisLockTtlMs) {
    throw new AppError(
      500,
      'INVALID_ENV',
      'IDEMPOTENCY_REDIS_LOCK_REFRESH_MS must be less than IDEMPOTENCY_REDIS_LOCK_TTL_MS',
    );
  }

  if (deploymentMode === 'shared') {
    if (!redisUrl) {
      throw new AppError(500, 'MISSING_ENV', 'REDIS_URL is required when DEPLOYMENT_MODE=shared');
    }
    if (!idempotencyEnabled) {
      throw new AppError(
        500,
        'INVALID_ENV',
        'IDEMPOTENCY_ENABLED must be true when DEPLOYMENT_MODE=shared',
      );
    }
    if (idempotencyBackend !== 'redis') {
      throw new AppError(
        500,
        'INVALID_ENV',
        'IDEMPOTENCY_BACKEND must be "redis" when DEPLOYMENT_MODE=shared',
      );
    }
  }

  return {
    port: parseNumber(process.env.PORT, 3000),
    deploymentMode,
    apiKey,
    apiKeys: resolvedApiKeys,
    defaultChainId,
    chains,
    privateKey,
    logLevel: process.env.LOG_LEVEL || 'info',
    readyRpcTimeoutMs: parseNumber(process.env.READY_RPC_TIMEOUT_MS, 2000),
    corsOrigins: parseStringArray(process.env.CORS_ORIGINS),
    rateLimit: {
      max: parseNumber(process.env.RATE_LIMIT_MAX, 100),
      timeWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    },
    redis: {
      url: redisUrl,
      keyPrefix: redisKeyPrefix,
    },
    idempotency: {
      enabled: idempotencyEnabled,
      backend: idempotencyBackend,
      requireKey: requireIdempotencyKey,
      ttlMs: parseNumber(process.env.IDEMPOTENCY_TTL_MS, 86_400_000),
      storePath: process.env.IDEMPOTENCY_STORE_PATH || '.data/idempotency-store.json',
      redisLockTtlMs: idempotencyRedisLockTtlMs,
      redisLockRefreshMs: idempotencyRedisLockRefreshMs,
    },
    pricing: {
      enabled: pricingEnabled,
      provider,
      baseUrl: process.env.PRICE_BASE_URL || 'https://api.coingecko.com/api/v3',
      timeoutMs: parseNumber(process.env.PRICE_TIMEOUT_MS, 3000),
      cacheTtlMs: parseNumber(process.env.PRICE_CACHE_TTL_MS, 15000),
      apiKey: process.env.PRICE_API_KEY,
    },
  };
};
