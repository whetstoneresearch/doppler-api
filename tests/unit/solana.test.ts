import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../src/core/config';
import {
  SOLANA_CONSTANTS,
  SolanaLaunchService,
  dedicatedSolanaCreateLaunchRequestSchema,
  deriveSolanaCurveConfig,
  deriveSolanaLaunchSeed,
  genericSolanaCreateLaunchRequestSchema,
  normalizeDedicatedSolanaCreateRequest,
} from '../../src/modules/launches/solana';

const buildConfig = (solanaOverrides: Partial<AppConfig['solana']> = {}): AppConfig => ({
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
    enabled: true,
    provider: 'coingecko',
    baseUrl: 'https://api.coingecko.com/api/v3',
    timeoutMs: 1000,
    cacheTtlMs: 1000,
    coingeckoAssetId: 'ethereum',
  },
  solana: {
    enabled: true,
    defaultNetwork: 'solanaDevnet',
    devnetRpcUrl: 'http://127.0.0.1:8899',
    devnetWsUrl: 'ws://127.0.0.1:8900',
    confirmTimeoutMs: 60_000,
    priceMode: 'required',
    coingeckoAssetId: 'solana',
    ...solanaOverrides,
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
});

describe('Solana launch helpers', () => {
  it('normalizes dedicated route network aliases to canonical Solana network names', () => {
    const parsed = dedicatedSolanaCreateLaunchRequestSchema.parse({
      network: 'devnet',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      governance: false,
      migration: { type: 'noOp' },
      auction: {
        type: 'xyk',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 1000,
        },
      },
    });

    expect(normalizeDedicatedSolanaCreateRequest(parsed, 'solanaMainnetBeta')).toMatchObject({
      network: 'solanaDevnet',
    });
  });

  it('defaults dedicated Solana requests to the configured canonical network', () => {
    const parsed = dedicatedSolanaCreateLaunchRequestSchema.parse({
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      governance: false,
      migration: { type: 'noOp' },
      auction: {
        type: 'xyk',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 1000,
        },
      },
    });

    expect(normalizeDedicatedSolanaCreateRequest(parsed, 'solanaMainnetBeta')).toMatchObject({
      network: 'solanaMainnetBeta',
    });
  });

  it('rejects unsupported Solana fields instead of ignoring them', () => {
    expect(() =>
      genericSolanaCreateLaunchRequestSchema.parse({
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: {
          totalSupply: '1000',
          tokensForSale: '100',
        },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      }),
    ).toThrow(/unrecognized key/i);
  });

  it('accepts optional Solana distribution and liquidity reserves', () => {
    const parsed = genericSolanaCreateLaunchRequestSchema.parse({
      network: 'solanaDevnet',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: {
        totalSupply: '1000',
        baseForDistribution: '100',
        baseForLiquidity: '200',
      },
      governance: false,
      migration: { type: 'noOp' },
      auction: {
        type: 'xyk',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 1000,
        },
      },
    });

    expect(parsed.economics.baseForDistribution).toBe('100');
    expect(parsed.economics.baseForLiquidity).toBe('200');
  });

  it('rejects governance, migration, and auction shapes that are outside the Solana profile', () => {
    expect(() =>
      genericSolanaCreateLaunchRequestSchema.parse({
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '1000' },
        governance: true,
        migration: { type: 'uniswapV2' },
        auction: {
          type: 'multicurve',
          curveConfig: {
            type: 'preset',
            presets: ['low'],
          },
        },
      }),
    ).toThrow();
  });

  it('enforces metadata bounds and u64 total-supply limits', () => {
    expect(() =>
      genericSolanaCreateLaunchRequestSchema.parse({
        network: 'solanaDevnet',
        tokenMetadata: {
          name: 'a'.repeat(33),
          symbol: 'TOK',
          tokenURI: 'ipfs://token',
        },
        economics: { totalSupply: '1000' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      }),
    ).toThrow();

    expect(() =>
      genericSolanaCreateLaunchRequestSchema.parse({
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '18446744073709551616' },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      }),
    ).toThrow();
  });

  it('derives deterministic Solana launch seeds from idempotency keys', () => {
    const first = deriveSolanaLaunchSeed('solanaDevnet', 'same-key');
    const second = deriveSolanaLaunchSeed('solanaDevnet', 'same-key');
    const third = deriveSolanaLaunchSeed('solanaMainnetBeta', 'same-key');

    expect(Buffer.from(first).toString('hex')).toBe(Buffer.from(second).toString('hex'));
    expect(Buffer.from(first).toString('hex')).not.toBe(Buffer.from(third).toString('hex'));
  });

  it('derives bounded Solana XYK virtual reserves from market-cap ranges', () => {
    const derived = deriveSolanaCurveConfig({
      totalSupply: 1_000_000_000n,
      baseForDistribution: 0n,
      baseForLiquidity: 0n,
      numerairePriceUsd: 100,
      marketCapStartUsd: 100,
      marketCapEndUsd: 1_000,
    });

    expect(derived.curveVirtualBase).toBeGreaterThan(0n);
    expect(derived.curveVirtualQuote).toBeGreaterThan(0n);
  });

  it('rejects invalid Solana curve ranges', () => {
    expect(() =>
      deriveSolanaCurveConfig({
        totalSupply: 1_000_000_000n,
        baseForDistribution: 0n,
        baseForLiquidity: 0n,
        numerairePriceUsd: 100,
        marketCapStartUsd: 1_000,
        marketCapEndUsd: 100,
      }),
    ).toThrow(/marketCapEndUsd must be greater than marketCapStartUsd/i);
  });

  it('rejects reserve splits that consume the full Solana supply', () => {
    expect(() =>
      genericSolanaCreateLaunchRequestSchema.parse({
        network: 'solanaDevnet',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: {
          totalSupply: '1000',
          baseForDistribution: '500',
          baseForLiquidity: '500',
        },
        governance: false,
        migration: { type: 'noOp' },
        auction: {
          type: 'xyk',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 1000,
          },
        },
      }),
    ).toThrow(/must be less than economics\.totalSupply/i);
  });

  it('resolves Solana numeraire price by request override, fixed env price, then CoinGecko', async () => {
    const pricingService = {
      getUsdPriceByAssetId: vi.fn().mockResolvedValue(321),
    } as any;

    const serviceWithFixedPrice = new SolanaLaunchService({
      config: buildConfig({
        fixedNumerairePriceUsd: 123,
        priceMode: 'coingecko',
      }),
      pricingService,
    });

    const overridePrice = await (serviceWithFixedPrice as any).resolveNumerairePriceUsd(
      {
        pricing: { numerairePriceUsd: 456 },
      },
      SOLANA_CONSTANTS.wsolMintAddress,
    );
    expect(overridePrice).toBe(456);
    expect(pricingService.getUsdPriceByAssetId).not.toHaveBeenCalled();

    const fixedPrice = await (serviceWithFixedPrice as any).resolveNumerairePriceUsd(
      {},
      SOLANA_CONSTANTS.wsolMintAddress,
    );
    expect(fixedPrice).toBe(123);
    expect(pricingService.getUsdPriceByAssetId).not.toHaveBeenCalled();

    const serviceWithCoingecko = new SolanaLaunchService({
      config: buildConfig({
        fixedNumerairePriceUsd: undefined,
        priceMode: 'coingecko',
      }),
      pricingService,
    });
    const coingeckoPrice = await (serviceWithCoingecko as any).resolveNumerairePriceUsd(
      {},
      SOLANA_CONSTANTS.wsolMintAddress,
    );

    expect(coingeckoPrice).toBe(321);
    expect(pricingService.getUsdPriceByAssetId).toHaveBeenCalledWith('solana');
  });

  it('fails closed when Solana price resolution is required but unavailable', async () => {
    const service = new SolanaLaunchService({
      config: buildConfig({
        fixedNumerairePriceUsd: undefined,
        priceMode: 'required',
      }),
      pricingService: {
        getUsdPriceByAssetId: vi.fn(),
      } as any,
    });

    await expect(
      (service as any).resolveNumerairePriceUsd({}, SOLANA_CONSTANTS.wsolMintAddress),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'SOLANA_NUMERAIRE_PRICE_REQUIRED',
    });
  });
});
