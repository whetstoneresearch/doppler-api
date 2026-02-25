import { buildServer, type AppServices } from '../../src/app/server';
import type { AppConfig } from '../../src/core/config';
import { MetricsRegistry } from '../../src/core/metrics';

export const buildTestServer = async () => {
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

  const buildLaunchResponse = (payload?: {
    userAddress?: string;
    tokenomics?: {
      totalSupply?: string;
      tokensForSale?: string;
      allocations?: {
        recipientAddress?: string;
        allocations?: Array<{ address: string; amount: string }>;
        recipients?: Array<{ address: string; amount: string }>;
        mode?: 'vest' | 'unlock' | 'vault';
        durationSeconds?: number;
      };
    };
  }) => {
    const totalSupply = BigInt(payload?.tokenomics?.totalSupply ?? '1000');
    const explicitAllocations =
      payload?.tokenomics?.allocations?.recipients ??
      payload?.tokenomics?.allocations?.allocations ??
      [];
    const explicitAllocationTotal = explicitAllocations.reduce(
      (sum, entry) => sum + BigInt(entry.amount),
      0n,
    );
    const tokensForSale = BigInt(
      payload?.tokenomics?.tokensForSale ??
        (explicitAllocations.length > 0
          ? (totalSupply - explicitAllocationTotal).toString()
          : totalSupply.toString()),
    );
    const allocationAmount = totalSupply - tokensForSale;
    const allocationMode =
      allocationAmount > 0n ? (payload?.tokenomics?.allocations?.mode ?? 'vest') : 'none';
    const allocationDuration =
      allocationMode === 'none'
        ? 0
        : allocationMode === 'unlock'
          ? 0
          : (payload?.tokenomics?.allocations?.durationSeconds ?? 90 * 24 * 60 * 60);
    const allocationRecipients =
      explicitAllocations.length > 0
        ? explicitAllocations
        : allocationAmount > 0n
          ? [
              {
                address:
                  payload?.tokenomics?.allocations?.recipientAddress ??
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
    launchService: {
      createLaunch: async (payload?: { governance?: unknown }) => {
        return buildLaunchResponse(payload as any);
      },
      createLaunchWithIdempotency: async (payload?: { governance?: unknown; input?: any }) => {
        return {
          replayed: false,
          response: buildLaunchResponse((payload as any)?.input),
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
