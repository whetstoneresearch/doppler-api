import { buildServer, type AppServices } from '../../src/app/server';
import type { AppConfig } from '../../src/core/config';
import { AppError } from '../../src/core/errors';
import { MetricsRegistry } from '../../src/core/metrics';

interface BuildTestServerOptions {
  readyCheckFails?: boolean;
  solanaEnabled?: boolean;
  solanaReadyCheckFails?: boolean;
  solanaCreateError?: {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  };
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
};

export const buildTestServer = async (options: BuildTestServerOptions = {}) => {
  const config: AppConfig = {
    port: 3000,
    deploymentMode: 'standalone',
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
      coingeckoAssetId: 'ethereum',
    },
    solana: {
      enabled: options.solanaEnabled ?? false,
      defaultNetwork: 'solanaDevnet',
      devnetRpcUrl: 'http://127.0.0.1:8899',
      devnetWsUrl: 'ws://127.0.0.1:8900',
      confirmTimeoutMs: 60_000,
      useAlt: false,
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
  const solanaReadinessChecks = options.solanaReadyCheckFails
    ? [{ name: 'rpcReachable', ok: false, error: 'dependency unavailable' }]
    : [
        { name: 'rpcReachable', ok: true },
        { name: 'latestBlockhash', ok: true },
        { name: 'initializerConfig', ok: true },
        { name: 'addressLookupTable', ok: true },
      ];

  const fakeChain = {
    chainId: 84532,
    config: config.chains[84532],
    addresses: { airlock: '0x0000000000000000000000000000000000000001' },
    publicClient: {
      getBlockNumber: async () => {
        if (options.readyCheckFails) {
          throw new Error('rpc provider request failed with internal details');
        }
        return 123n;
      },
    },
    walletClient: {},
  } as any;

  const buildLaunchResponse = (payload?: {
    userAddress?: string;
    economics?: {
      totalSupply?: string;
      tokensForSale?: string;
      allocations?: {
        recipientAddress?: string;
        recipients?: Array<{ address: string; amount: string }>;
        mode?: 'vest' | 'unlock' | 'vault';
        durationSeconds?: number;
      };
    };
  }) => {
    const totalSupply = BigInt(payload?.economics?.totalSupply ?? '1000');
    const explicitAllocations = payload?.economics?.allocations?.recipients ?? [];
    const explicitAllocationTotal = explicitAllocations.reduce(
      (sum, entry) => sum + BigInt(entry.amount),
      0n,
    );
    const tokensForSale = BigInt(
      payload?.economics?.tokensForSale ??
        (explicitAllocations.length > 0
          ? (totalSupply - explicitAllocationTotal).toString()
          : totalSupply.toString()),
    );
    const allocationAmount = totalSupply - tokensForSale;
    const allocationMode =
      allocationAmount > 0n ? (payload?.economics?.allocations?.mode ?? 'vest') : 'none';
    const allocationDuration =
      allocationMode === 'none'
        ? 0
        : allocationMode === 'unlock'
          ? 0
          : (payload?.economics?.allocations?.durationSeconds ?? 90 * 24 * 60 * 60);
    const allocationRecipients =
      explicitAllocations.length > 0
        ? explicitAllocations
        : allocationAmount > 0n
          ? [
              {
                address:
                  payload?.economics?.allocations?.recipientAddress ??
                  payload?.userAddress ??
                  '0x1111111111111111111111111111111111111111',
                amount: allocationAmount.toString(),
              },
            ]
          : [];

    return {
      launchId: '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 84532,
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      statusUrl:
        '/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      predicted: {
        tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        poolId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      effectiveConfig: {
        tokensForSale: tokensForSale.toString(),
        allocationAmount: allocationAmount.toString(),
        allocationRecipient:
          allocationRecipients[0]?.address ?? '0x1111111111111111111111111111111111111111',
        allocationRecipients,
        allocationLockMode: allocationMode as 'none' | 'vest' | 'unlock' | 'vault',
        allocationLockDurationSeconds: allocationDuration,
        numeraireAddress: '0x4200000000000000000000000000000000000006',
        numerairePriceUsd: 100,
        feeBeneficiariesSource: 'default' as const,
      },
    };
  };

  const buildSolanaLaunchResponse = (payload?: {
    network?: 'solanaDevnet' | 'solanaMainnetBeta';
    economics?: { totalSupply?: string };
    pairing?: { numeraireAddress?: string };
    pricing?: { numerairePriceUsd?: number };
    auction?: {
      curveConfig?: {
        marketCapStartUsd?: number;
        marketCapEndUsd?: number;
      };
      curveFeeBps?: number;
      allowBuy?: boolean;
      allowSell?: boolean;
    };
  }) => {
    const totalSupply = payload?.economics?.totalSupply ?? '1000';

    return {
      launchId: '8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP',
      network: payload?.network ?? 'solanaDevnet',
      signature: '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
      explorerUrl:
        'https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet',
      predicted: {
        tokenAddress: '6QWeT6FpJrm8AF1btu6WH2k2Xhq6t5vbheKVfQavmeoZ',
        launchAuthorityAddress: 'E7Ud4m8S7fC2YdUQdL7p9V2sRrMfQjQ9fA5spuR4T9gQ',
        baseVaultAddress: '9xQeWvG816bUx9EPjHmaT23yvVMHh2eHq9cYqB9Yg6xT',
        quoteVaultAddress: 'J1veWvV6BF8L7rN8D66zCFAaj6MqFmoVoeAQMtkP8dwF',
      },
      effectiveConfig: {
        tokensForSale: totalSupply,
        allocationAmount: '0',
        allocationLockMode: 'none' as const,
        numeraireAddress:
          payload?.pairing?.numeraireAddress ?? 'So11111111111111111111111111111111111111112',
        numerairePriceUsd: payload?.pricing?.numerairePriceUsd ?? 100,
        curveVirtualBase: '1000000000',
        curveVirtualQuote: '100000000',
        curveFeeBps: payload?.auction?.curveFeeBps ?? 0,
        allowBuy: payload?.auction?.allowBuy ?? true,
        allowSell: payload?.auction?.allowSell ?? true,
        tokenDecimals: 9,
      },
    };
  };

  const idempotencyResults = new Map<string, { payloadHash: string; response: unknown }>();

  const resolveLaunchResponse = (input: unknown) => {
    if (typeof input === 'object' && input !== null && 'network' in input) {
      const solanaInput = input as {
        network?: 'solanaDevnet' | 'solanaMainnetBeta';
        auction?: {
          curveConfig?: {
            marketCapStartUsd?: number;
            marketCapEndUsd?: number;
          };
        };
      };

      if (solanaInput.network === 'solanaMainnetBeta') {
        throw new AppError(
          501,
          'SOLANA_NETWORK_UNSUPPORTED',
          'solanaMainnetBeta is scaffolded but not executable in this API profile',
        );
      }

      if (
        solanaInput.auction?.curveConfig?.marketCapStartUsd !== undefined &&
        solanaInput.auction?.curveConfig?.marketCapEndUsd !== undefined &&
        solanaInput.auction.curveConfig.marketCapEndUsd <=
          solanaInput.auction.curveConfig.marketCapStartUsd
      ) {
        throw new AppError(
          422,
          'SOLANA_INVALID_CURVE',
          'marketCapEndUsd must be greater than marketCapStartUsd',
        );
      }

      if (options.solanaCreateError) {
        throw new AppError(
          options.solanaCreateError.statusCode,
          options.solanaCreateError.code,
          options.solanaCreateError.message,
          options.solanaCreateError.details,
        );
      }

      return buildSolanaLaunchResponse(solanaInput);
    }

    return buildLaunchResponse(input as Parameters<typeof buildLaunchResponse>[0]);
  };

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
      getReadiness: async () =>
        config.solana.enabled
          ? {
              enabled: true,
              network: 'solanaDevnet',
              ok: !options.solanaReadyCheckFails,
              checks: solanaReadinessChecks,
            }
          : { enabled: false, ok: true, checks: [] },
      createLaunch: async () => {
        throw new Error('not used');
      },
    } as any,
    launchService: {
      createLaunch: async (payload?: { governance?: unknown }) => {
        return resolveLaunchResponse(payload);
      },
      createLaunchWithIdempotency: async (payload?: { governance?: unknown; input?: unknown; idempotencyKey?: string }) => {
        const key = payload?.idempotencyKey?.trim();
        const input = payload?.input;

        if (!key) {
          return {
            replayed: false,
            response: resolveLaunchResponse(input),
          };
        }

        const payloadHash = stableStringify(input);
        const existing = idempotencyResults.get(key);
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new AppError(
              409,
              'IDEMPOTENCY_KEY_REUSE_MISMATCH',
              'Idempotency-Key was already used with a different request payload',
            );
          }

          return {
            replayed: true,
            response: existing.response,
          };
        }

        const response = resolveLaunchResponse(input);
        idempotencyResults.set(key, { payloadHash, response });

        return {
          replayed: false,
          response,
        };
      },
    } as any,
    statusService: {
      getLaunchStatus: async () => ({
        launchId: '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 84532,
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'pending',
        confirmations: 0,
      }),
    } as any,
  };

  return buildServer(services);
};
