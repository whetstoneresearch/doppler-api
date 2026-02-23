import 'dotenv/config';

import { z } from 'zod';

import { AppError } from './errors';
import type { AuctionType, GovernanceMode, MigrationType } from './types';

const DEFAULT_AUCTION_TYPES: AuctionType[] = ['multicurve'];
const DEFAULT_MIGRATION_TYPES: MigrationType[] = ['noOp'];
const DEFAULT_GOVERNANCE_MODES: GovernanceMode[] = ['noOp'];

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
  idempotency: {
    enabled: boolean;
    requireKey: boolean;
    ttlMs: number;
    storePath: string;
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

    mapped[chainId] = {
      chainId,
      rpcUrl: value.rpcUrl,
      defaultNumeraireAddress: value.defaultNumeraireAddress as `0x${string}` | undefined,
      auctionTypes: value.auctionTypes ?? DEFAULT_AUCTION_TYPES,
      migrationModes: value.migrationModes ?? DEFAULT_MIGRATION_TYPES,
      governanceModes,
      governanceEnabled: value.governanceEnabled ?? false,
    };
  }

  return mapped;
};

export const loadConfig = (): AppConfig => {
  const apiKey = process.env.API_KEY;
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;

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
      governanceEnabled: false,
    };
  }

  const pricingEnabled = parseBoolean(process.env.PRICE_ENABLED, true);
  const provider = (process.env.PRICE_PROVIDER?.trim() || 'coingecko') as 'coingecko' | 'none';
  const apiKeys = parseStringArray(process.env.API_KEYS);
  const resolvedApiKeys = [...new Set([apiKey, ...apiKeys].filter(Boolean) as string[])];

  return {
    port: parseNumber(process.env.PORT, 3000),
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
    idempotency: {
      enabled: parseBoolean(process.env.IDEMPOTENCY_ENABLED, true),
      requireKey: parseBoolean(process.env.IDEMPOTENCY_REQUIRE_KEY, false),
      ttlMs: parseNumber(process.env.IDEMPOTENCY_TTL_MS, 86_400_000),
      storePath: process.env.IDEMPOTENCY_STORE_PATH || '.data/idempotency-store.json',
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
