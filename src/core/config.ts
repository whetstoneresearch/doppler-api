import 'dotenv/config';

import { AppError } from './errors';
import type { AuctionType, GovernanceMode, MigrationType, SolanaNetwork } from './types';
import { dopplerTemplateConfig } from '../../doppler.config';
import type {
  DeploymentMode,
  DopplerTemplateConfigV1,
  IdempotencyBackend,
  PriceProvider,
} from './template-config';

export type { DeploymentMode, IdempotencyBackend };

export interface ChainRuntimeConfig {
  chainId: number;
  rpcUrl: string;
  defaultNumeraireAddress?: `0x${string}`;
  auctionTypes: AuctionType[];
  migrationModes: MigrationType[];
  governanceModes: GovernanceMode[];
  governanceEnabled: boolean;
}

export interface SolanaRuntimeConfig {
  enabled: boolean;
  defaultNetwork: SolanaNetwork;
  devnetRpcUrl: string;
  devnetWsUrl: string;
  mainnetBetaRpcUrl?: string;
  mainnetBetaWsUrl?: string;
  keypairBytes?: Uint8Array;
  confirmTimeoutMs: number;
  useAlt: boolean;
  altAddress?: string;
  priceMode: 'required' | 'fixed' | 'coingecko';
  fixedNumerairePriceUsd?: number;
  coingeckoAssetId: string;
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
    provider: PriceProvider;
    baseUrl: string;
    timeoutMs: number;
    cacheTtlMs: number;
    coingeckoAssetId: string;
    apiKey?: string;
  };
  solana: SolanaRuntimeConfig;
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

const parseOptionalPositiveNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(500, 'INVALID_ENV', `Expected a positive number but received ${value}`);
  }

  return parsed;
};

const parseStringArray = (value: string | undefined): string[] => {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseDeploymentMode = (fallback: DeploymentMode): DeploymentMode => {
  const raw = process.env.DEPLOYMENT_MODE?.trim().toLowerCase();
  if (!raw) {
    if (process.env.NODE_ENV?.trim().toLowerCase() === 'production') {
      return 'shared';
    }
    return fallback;
  }

  if (raw === 'standalone' || raw === 'shared') {
    return raw;
  }

  throw new AppError(500, 'INVALID_ENV', 'DEPLOYMENT_MODE must be "standalone" or "shared"');
};

const parseIdempotencyBackend = (fallback: IdempotencyBackend): IdempotencyBackend => {
  const raw = process.env.IDEMPOTENCY_BACKEND?.trim().toLowerCase() || fallback;
  if (raw === 'file' || raw === 'redis') {
    return raw;
  }

  throw new AppError(500, 'INVALID_ENV', 'IDEMPOTENCY_BACKEND must be "file" or "redis"');
};

const parsePricingProvider = (fallback: PriceProvider): PriceProvider => {
  const raw = process.env.PRICE_PROVIDER?.trim().toLowerCase() || fallback;
  if (raw === 'coingecko' || raw === 'none') {
    return raw;
  }

  throw new AppError(500, 'INVALID_ENV', 'PRICE_PROVIDER must be "coingecko" or "none"');
};

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (!value || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(500, 'INVALID_ENV', `Expected a positive integer but received ${value}`);
  }

  return parsed;
};

const parseStringOrFallback = (value: string | undefined, fallback: string): string => {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
};

const parseSolanaDefaultNetwork = (
  value: string | undefined,
  fallback: SolanaNetwork,
): SolanaNetwork => {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  if (raw === 'solanaDevnet' || raw === 'solanaMainnetBeta') {
    return raw;
  }

  throw new AppError(
    500,
    'INVALID_ENV',
    'SOLANA_DEFAULT_NETWORK must be "solanaDevnet" or "solanaMainnetBeta"',
  );
};

const parseSolanaPriceMode = (value: string | undefined): 'required' | 'fixed' | 'coingecko' => {
  const raw = value?.trim().toLowerCase() || 'required';
  if (raw === 'required' || raw === 'fixed' || raw === 'coingecko') {
    return raw;
  }

  throw new AppError(
    500,
    'INVALID_ENV',
    'SOLANA_PRICE_MODE must be "required", "fixed", or "coingecko"',
  );
};

const parseSolanaKeypairBytes = (value: string | undefined): Uint8Array | undefined => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError(
      500,
      'INVALID_ENV',
      'SOLANA_KEYPAIR must be a JSON array containing 64 secret-key bytes',
    );
  }

  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new AppError(
      500,
      'INVALID_ENV',
      'SOLANA_KEYPAIR must be a JSON array containing 64 secret-key bytes',
    );
  }

  const bytes = parsed.map((entry) => {
    if (!Number.isInteger(entry) || entry < 0 || entry > 255) {
      throw new AppError(
        500,
        'INVALID_ENV',
        'SOLANA_KEYPAIR must contain only byte values between 0 and 255',
      );
    }
    return entry;
  });

  return Uint8Array.from(bytes);
};

const parseOptionalStringArray = (value: string | undefined): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return parseStringArray(value);
};

const resolveTemplateChains = (
  template: DopplerTemplateConfigV1,
): Record<number, ChainRuntimeConfig> => {
  const entries = Object.entries(template.chains);
  if (entries.length === 0) {
    throw new AppError(500, 'INVALID_ENV', 'doppler.config.ts must define at least one chain');
  }

  const mapped: Record<number, ChainRuntimeConfig> = {};
  for (const [chainIdStr, value] of entries) {
    const chainId = Number(chainIdStr);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new AppError(
        500,
        'INVALID_ENV',
        `Invalid chainId key in doppler.config.ts: ${chainIdStr}`,
      );
    }

    if (!value.rpcUrl || value.rpcUrl.trim() === '') {
      throw new AppError(
        500,
        'INVALID_ENV',
        `Missing rpcUrl for chain ${chainId} in doppler.config.ts`,
      );
    }

    mapped[chainId] = {
      chainId,
      rpcUrl: value.rpcUrl,
      defaultNumeraireAddress: value.defaultNumeraireAddress as `0x${string}` | undefined,
      auctionTypes: value.auctionTypes,
      migrationModes: value.migrationModes,
      governanceModes: value.governanceModes,
      governanceEnabled: value.governanceEnabled,
    };
  }

  return mapped;
};

export const loadConfig = (): AppConfig => {
  const template = dopplerTemplateConfig;
  const apiKey = process.env.API_KEY;
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
  const deploymentMode = parseDeploymentMode(template.deploymentMode);
  const redisUrl = process.env.REDIS_URL?.trim() || undefined;
  const redisKeyPrefix = parseStringOrFallback(
    process.env.REDIS_KEY_PREFIX,
    template.redis.keyPrefix,
  );
  const idempotencyEnabled = parseBoolean(
    process.env.IDEMPOTENCY_ENABLED,
    template.idempotency.enabled,
  );
  const idempotencyBackend = parseIdempotencyBackend(template.idempotency.backend);
  const idempotencyRedisLockTtlMs = parseNumber(
    process.env.IDEMPOTENCY_REDIS_LOCK_TTL_MS,
    template.idempotency.redisLockTtlMs,
  );
  const idempotencyRedisLockRefreshMs = parseNumber(
    process.env.IDEMPOTENCY_REDIS_LOCK_REFRESH_MS,
    template.idempotency.redisLockRefreshMs,
  );

  if (!apiKey) {
    throw new AppError(500, 'MISSING_ENV', 'API_KEY is required');
  }
  if (!privateKey) {
    throw new AppError(500, 'MISSING_ENV', 'PRIVATE_KEY is required');
  }

  const defaultChainId = parseInteger(process.env.DEFAULT_CHAIN_ID, template.defaultChainId);
  const chains = resolveTemplateChains(template);

  if (!chains[defaultChainId]) {
    throw new AppError(
      500,
      'INVALID_ENV',
      `DEFAULT_CHAIN_ID ${defaultChainId} is not configured in doppler.config.ts`,
    );
  }

  const rpcUrlOverride = process.env.RPC_URL?.trim();
  if (rpcUrlOverride) {
    chains[defaultChainId] = {
      ...chains[defaultChainId],
      rpcUrl: rpcUrlOverride,
    };
  }

  const defaultNumeraireAddressOverride = process.env.DEFAULT_NUMERAIRE_ADDRESS as
    | `0x${string}`
    | undefined;
  if (defaultNumeraireAddressOverride) {
    chains[defaultChainId] = {
      ...chains[defaultChainId],
      defaultNumeraireAddress: defaultNumeraireAddressOverride,
    };
  }

  const pricingEnabled = parseBoolean(process.env.PRICE_ENABLED, template.pricing.enabled);
  const provider = parsePricingProvider(template.pricing.provider);
  const apiKeys = parseStringArray(process.env.API_KEYS);
  const resolvedApiKeys = [...new Set([apiKey, ...apiKeys].filter(Boolean) as string[])];
  const requireIdempotencyKey =
    deploymentMode === 'shared'
      ? true
      : parseBoolean(process.env.IDEMPOTENCY_REQUIRE_KEY, template.idempotency.requireKey);

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

  const solanaEnabled = parseBoolean(process.env.SOLANA_ENABLED, false);
  const solanaDefaultNetwork = parseSolanaDefaultNetwork(
    process.env.SOLANA_DEFAULT_NETWORK,
    'solanaDevnet',
  );
  const solanaPriceMode = parseSolanaPriceMode(process.env.SOLANA_PRICE_MODE);
  const solanaKeypairBytes = parseSolanaKeypairBytes(process.env.SOLANA_KEYPAIR);
  const solanaFixedNumerairePriceUsd =
    solanaPriceMode === 'required'
      ? undefined
      : parseOptionalPositiveNumber(process.env.SOLANA_FIXED_NUMERAIRE_PRICE_USD);
  const solanaAltAddress = process.env.SOLANA_DEVNET_ALT_ADDRESS?.trim() || undefined;

  if (solanaEnabled) {
    if (!solanaKeypairBytes) {
      throw new AppError(500, 'MISSING_ENV', 'SOLANA_KEYPAIR is required when SOLANA_ENABLED=true');
    }

    if (!process.env.SOLANA_DEVNET_RPC_URL?.trim()) {
      throw new AppError(
        500,
        'MISSING_ENV',
        'SOLANA_DEVNET_RPC_URL is required when SOLANA_ENABLED=true',
      );
    }

    if (!process.env.SOLANA_DEVNET_WS_URL?.trim()) {
      throw new AppError(
        500,
        'MISSING_ENV',
        'SOLANA_DEVNET_WS_URL is required when SOLANA_ENABLED=true',
      );
    }

    if (solanaPriceMode === 'fixed' && solanaFixedNumerairePriceUsd === undefined) {
      throw new AppError(
        500,
        'MISSING_ENV',
        'SOLANA_FIXED_NUMERAIRE_PRICE_USD is required when SOLANA_PRICE_MODE=fixed',
      );
    }
  }

  return {
    port: parseNumber(process.env.PORT, template.port),
    deploymentMode,
    apiKey,
    apiKeys: resolvedApiKeys,
    defaultChainId,
    chains,
    privateKey,
    logLevel: parseStringOrFallback(process.env.LOG_LEVEL, template.logLevel),
    readyRpcTimeoutMs: parseNumber(process.env.READY_RPC_TIMEOUT_MS, template.readyRpcTimeoutMs),
    corsOrigins: parseOptionalStringArray(process.env.CORS_ORIGINS) ?? [...template.corsOrigins],
    rateLimit: {
      max: parseNumber(process.env.RATE_LIMIT_MAX, template.rateLimit.max),
      timeWindowMs: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, template.rateLimit.timeWindowMs),
    },
    redis: {
      url: redisUrl,
      keyPrefix: redisKeyPrefix,
    },
    idempotency: {
      enabled: idempotencyEnabled,
      backend: idempotencyBackend,
      requireKey: requireIdempotencyKey,
      ttlMs: parseNumber(process.env.IDEMPOTENCY_TTL_MS, template.idempotency.ttlMs),
      storePath: parseStringOrFallback(
        process.env.IDEMPOTENCY_STORE_PATH,
        template.idempotency.storePath,
      ),
      redisLockTtlMs: idempotencyRedisLockTtlMs,
      redisLockRefreshMs: idempotencyRedisLockRefreshMs,
    },
    pricing: {
      enabled: pricingEnabled,
      provider,
      baseUrl: parseStringOrFallback(process.env.PRICE_BASE_URL, template.pricing.baseUrl),
      timeoutMs: parseNumber(process.env.PRICE_TIMEOUT_MS, template.pricing.timeoutMs),
      cacheTtlMs: parseNumber(process.env.PRICE_CACHE_TTL_MS, template.pricing.cacheTtlMs),
      coingeckoAssetId: parseStringOrFallback(
        process.env.PRICE_COINGECKO_ASSET_ID,
        template.pricing.coingeckoAssetId,
      ),
      apiKey: process.env.PRICE_API_KEY,
    },
    solana: {
      enabled: solanaEnabled,
      defaultNetwork: solanaDefaultNetwork,
      devnetRpcUrl: parseStringOrFallback(
        process.env.SOLANA_DEVNET_RPC_URL,
        'https://api.devnet.solana.com',
      ),
      devnetWsUrl: parseStringOrFallback(
        process.env.SOLANA_DEVNET_WS_URL,
        'wss://api.devnet.solana.com',
      ),
      mainnetBetaRpcUrl: process.env.SOLANA_MAINNET_BETA_RPC_URL?.trim() || undefined,
      mainnetBetaWsUrl: process.env.SOLANA_MAINNET_BETA_WS_URL?.trim() || undefined,
      keypairBytes: solanaKeypairBytes,
      confirmTimeoutMs: parseInteger(process.env.SOLANA_CONFIRM_TIMEOUT_MS, 60_000),
      useAlt: parseBoolean(process.env.SOLANA_DEVNET_USE_ALT, true),
      altAddress: solanaAltAddress,
      priceMode: solanaPriceMode,
      fixedNumerairePriceUsd: solanaFixedNumerairePriceUsd,
      coingeckoAssetId: parseStringOrFallback(process.env.SOLANA_COINGECKO_ASSET_ID, 'solana'),
    },
  };
};
