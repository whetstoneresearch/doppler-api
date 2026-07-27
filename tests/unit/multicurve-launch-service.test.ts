// allow: SIZE_OK — SDK-backed canonical launch scenarios share one typed harness.
import {
  getAddresses,
  MulticurveBuilder,
  type CreateMulticurveParams,
  type CreateParams,
  type MulticurveMarketCapCurvesConfig,
  type RehypeDopplerHookInitializerConfig,
} from '@whetstone-research/doppler-sdk/evm';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../src/core/config';
import type { ChainContext } from '../../src/infra/chain/registry';
import { DopplerSdkRegistry } from '../../src/infra/doppler/sdk-client';
import { TxSubmitter } from '../../src/infra/tx/submitter';
import { createMulticurveLaunch } from '../../src/modules/auctions/multicurve/service';
import type { CreateMulticurveLaunchRequestInput } from '../../src/modules/launches/schema';
import { PricingService } from '../../src/modules/pricing/service';

const USER = '0x1111111111111111111111111111111111111111';
const BENEFICIARY = '0x2222222222222222222222222222222222222222';
const REHYPE_BENEFICIARY_TWO = '0x5555555555555555555555555555555555555555';
const REHYPE_BENEFICIARY_THREE = '0x6666666666666666666666666666666666666666';
const PROTOCOL_OWNER = '0x9999999999999999999999999999999999999999';
const BUYBACK_DESTINATION = '0x3333333333333333333333333333333333333333';
const CONTROLLER = '0x4444444444444444444444444444444444444444';
const EXCLUDED = '0x5555555555555555555555555555555555555555';
const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;
const CHAIN_IDS = [1, 143, 4663, 8453, 84532] as const;

const pricingConfig = {
  port: 0,
  deploymentMode: 'standalone',
  apiKey: 'test-key',
  apiKeys: ['test-key'],
  defaultChainId: 84532,
  chains: {},
  privateKey: PRIVATE_KEY,
  logLevel: 'silent',
  readyRpcTimeoutMs: 1,
  corsOrigins: [],
  rateLimit: { max: 1, timeWindowMs: 1 },
  redis: { keyPrefix: 'test' },
  idempotency: {
    enabled: false,
    backend: 'file',
    requireKey: false,
    ttlMs: 1,
    storePath: '.data/test.json',
    redisLockTtlMs: 1,
    redisLockRefreshMs: 1,
  },
  pricing: {
    enabled: false,
    provider: 'none',
    baseUrl: 'https://example.invalid',
    timeoutMs: 1,
    cacheTtlMs: 1,
    coingeckoAssetId: 'ethereum',
  },
  solana: {
    enabled: false,
    defaultNetwork: 'solanaDevnet',
    devnetRpcUrl: 'https://example.invalid',
    devnetWsUrl: 'wss://example.invalid',
    confirmTimeoutMs: 1,
    priceMode: 'required',
    coingeckoAssetId: 'solana',
  },
} satisfies AppConfig;

class CapturedMulticurveParamsError extends Error {
  constructor(
    readonly params: CreateMulticurveParams,
    readonly createParams: CreateParams,
  ) {
    super('Captured canonical multicurve params');
  }
}

const buildChain = (chainId: number): ChainContext => {
  const chainDefinition = defineChain({
    id: chainId,
    name: `test-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:1'] } },
  });
  const account = privateKeyToAccount(PRIVATE_KEY);

  return {
    chainId,
    config: {
      chainId,
      rpcUrl: 'http://127.0.0.1:1',
      defaultNumeraireAddress: getAddresses(chainId).weth,
      auctionTypes: ['multicurve'],
      migrationModes: ['noOp'],
      governanceModes: ['noOp', 'default', 'launchpad'],
      governanceEnabled: true,
    },
    addresses: getAddresses(chainId),
    publicClient: createPublicClient({ chain: chainDefinition, transport: http() }),
    walletClient: createWalletClient({ account, chain: chainDefinition, transport: http() }),
  };
};

const captureBuiltParams = async (
  input: CreateMulticurveLaunchRequestInput,
): Promise<CapturedMulticurveParamsError> => {
  const chain = buildChain(input.chainId ?? 84532);
  const sdkRegistry = new DopplerSdkRegistry([chain]);
  const sdk = sdkRegistry.get(chain.chainId);
  vi.spyOn(sdk, 'getAirlockOwner').mockResolvedValue(PROTOCOL_OWNER);
  vi.spyOn(sdk.factory, 'simulateCreateMulticurve').mockImplementation(async (params) => {
    throw new CapturedMulticurveParamsError(
      params,
      sdk.factory.encodeCreateMulticurveParams(params),
    );
  });
  const txSubmitter = new TxSubmitter();
  const submitSpy = vi.spyOn(txSubmitter, 'submitCreateTx');

  try {
    await createMulticurveLaunch({
      input,
      chain,
      sdkRegistry,
      pricingService: new PricingService(pricingConfig),
      txSubmitter,
    });
  } catch (error) {
    if (error instanceof CapturedMulticurveParamsError) {
      expect(submitSpy).not.toHaveBeenCalled();
      return error;
    }
    throw error;
  }

  throw new Error('Expected SDK params capture to stop launch submission');
};

const buildStandardInput = (chainId: number): CreateMulticurveLaunchRequestInput => ({
  chainId,
  userAddress: USER,
  tokenMetadata: {
    name: 'Canonical Multicurve',
    symbol: 'CMC',
    tokenURI: 'ipfs://canonical',
    maxBalanceLimit: '123456789',
    balanceLimitEnd: 4_000_000_000,
    controller: CONTROLLER,
    excludedFromBalanceLimit: [EXCLUDED],
  },
  economics: {
    totalSupply: '1000000000000000000000000000',
    tokensForSale: '800000000000000000000000000',
    allocations: [
      {
        recipientAddress: BENEFICIARY,
        amount: '200000000000000000000000000',
        durationSeconds: 86_400,
        cliffDurationSeconds: 3_600,
      },
    ],
  },
  pricing: { numerairePriceUsd: 3_000 },
  poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '950000000000000000' }],
  governance: true,
  auction: {
    type: 'multicurve',
    curveConfig: {
      type: 'ranges',
      fee: 10_000,
      curves: [
        {
          marketCapStartUsd: 10_000,
          marketCapEndUsd: 'max',
          numPositions: 10,
          sharesWad: '1000000000000000000',
        },
      ],
    },
    initializer: { type: 'standard' },
  },
});

describe('multicurve launch service', () => {
  it('builds the canonical DopplerHookInitializer on all configured EVM chains', async () => {
    const withCurvesSpy = vi.spyOn(MulticurveBuilder.prototype, 'withCurves');
    const withScheduleSpy = vi.spyOn(MulticurveBuilder.prototype, 'withSchedule');

    for (const chainId of CHAIN_IDS) {
      const captured = await captureBuiltParams(buildStandardInput(chainId));
      const addresses = getAddresses(chainId);

      expect(captured.params.modules?.dopplerHookInitializer).toBe(
        addresses.dopplerHookInitializer,
      );
      expect(captured.createParams.poolInitializer).toBe(addresses.dopplerHookInitializer);
      expect(captured.createParams.poolInitializerData).toMatch(/^0x[0-9a-f]+$/i);
      expect(captured.params.initializer).toEqual({ type: 'standard' });
      expect(withScheduleSpy).not.toHaveBeenCalled();
      expect(captured.params.token).toEqual({
        type: 'dopplerERC20V1',
        name: 'Canonical Multicurve',
        symbol: 'CMC',
        tokenURI: 'ipfs://canonical',
        maxBalanceLimit: 123456789n,
        balanceLimitEnd: 4_000_000_000,
        controller: CONTROLLER,
        excludedFromBalanceLimit: [EXCLUDED],
      });
      expect(captured.params.migration).toEqual({ type: 'noOp' });
      expect(captured.params.governance).toEqual({ type: 'default' });
      expect(captured.params.vesting).toEqual({
        allocations: [
          {
            recipient: BENEFICIARY,
            amount: 200000000000000000000000000n,
            schedule: { duration: 86_400, cliffDuration: 3_600 },
          },
        ],
      });
      expect(captured.params.pool.beneficiaries).toEqual(
        expect.arrayContaining([
          { beneficiary: BENEFICIARY, shares: 950000000000000000n },
          { beneficiary: PROTOCOL_OWNER, shares: 50000000000000000n },
        ]),
      );
    }

    const ranges = withCurvesSpy.mock.calls.at(-1)?.[0] satisfies
      | MulticurveMarketCapCurvesConfig
      | undefined;
    expect(ranges?.curves[0]?.marketCap.end).toBe('max');
  });

  it('builds the canonical RehypeDopplerHookInitializer with canonical hook separation', async () => {
    const withRehypeSpy = vi.spyOn(MulticurveBuilder.prototype, 'withRehypeDopplerHookInitializer');
    const input: CreateMulticurveLaunchRequestInput = {
      chainId: 84532,
      userAddress: USER,
      tokenMetadata: { name: 'Rehype', symbol: 'RHP', tokenURI: 'ipfs://rehype' },
      economics: { totalSupply: '1000', tokensForSale: '1000' },
      pricing: { numerairePriceUsd: 3_000 },
      poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '950000000000000000' }],
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['low', 'medium', 'high'] },
        initializer: {
          type: 'rehype',
          config: {
            buybackDestination: BUYBACK_DESTINATION,
            startFee: 30_000,
            endFee: 10_000,
            durationSeconds: 86_400,
            startingTime: 1_700_000_000,
            feeDistributionInfo: {
              assetFeesToAssetBuybackWad: '200000000000000000',
              assetFeesToNumeraireBuybackWad: '300000000000000000',
              assetFeesToBeneficiaryWad: '100000000000000000',
              assetFeesToLpWad: '400000000000000000',
              numeraireFeesToAssetBuybackWad: '200000000000000000',
              numeraireFeesToNumeraireBuybackWad: '300000000000000000',
              numeraireFeesToBeneficiaryWad: '100000000000000000',
              numeraireFeesToLpWad: '400000000000000000',
            },
            graduationCalldata: '0x1234',
            farTick: 200_000,
          },
        },
      },
    };

    const captured = await captureBuiltParams(input);
    const addresses = getAddresses(84532);
    const rehypeConfig = withRehypeSpy.mock.calls.at(-1)?.[0] satisfies
      | RehypeDopplerHookInitializerConfig
      | undefined;

    expect(captured.params.modules?.dopplerHookInitializer).toBe(addresses.dopplerHookInitializer);
    expect(captured.createParams.poolInitializer).toBe(addresses.dopplerHookInitializer);
    expect(captured.createParams.poolInitializerData).toMatch(/^0x[0-9a-f]+$/i);
    expect(rehypeConfig).toMatchObject({
      hookAddress: addresses.rehypeDopplerHookInitializer,
      buybackDestination: BUYBACK_DESTINATION,
      startFee: 30_000,
      endFee: 10_000,
      durationSeconds: 86_400,
      startingTime: 1_700_000_000,
      feeDistributionInfo: {
        assetFeesToAssetBuybackWad: 200000000000000000n,
        assetFeesToNumeraireBuybackWad: 300000000000000000n,
        assetFeesToBeneficiaryWad: 100000000000000000n,
        assetFeesToLpWad: 400000000000000000n,
        numeraireFeesToAssetBuybackWad: 200000000000000000n,
        numeraireFeesToNumeraireBuybackWad: 300000000000000000n,
        numeraireFeesToBeneficiaryWad: 100000000000000000n,
        numeraireFeesToLpWad: 400000000000000000n,
      },
      graduationCalldata: '0x1234',
      farTick: 200_000,
    });
    expect(rehypeConfig).not.toHaveProperty('feeBeneficiaries');
    expect(rehypeConfig).not.toHaveProperty('feeRoutingMode');
    expect(captured.params.pool.beneficiaries).toEqual(
      expect.arrayContaining([
        { beneficiary: BENEFICIARY, shares: 950000000000000000n },
        { beneficiary: PROTOCOL_OWNER, shares: 50000000000000000n },
      ]),
    );
    expect(captured.params.migration).toEqual({ type: 'noOp' });
    expect(captured.params.governance).toEqual({ type: 'noOp' });
    expect(captured.params.token).toMatchObject({ type: 'dopplerERC20V1' });
    expect(captured.params.initializer).toMatchObject({
      type: 'rehype',
      config: {
        hookAddress: addresses.rehypeDopplerHookInitializer,
        buybackDestination: BUYBACK_DESTINATION,
        startFee: 30_000,
        endFee: 10_000,
        durationSeconds: 86_400,
        startingTime: 1_700_000_000,
      },
    });
  });

  it('passes Rehype fee beneficiaries without appending the Airlock owner', async () => {
    const withRehypeSpy = vi.spyOn(MulticurveBuilder.prototype, 'withRehypeDopplerHookInitializer');
    const input: CreateMulticurveLaunchRequestInput = {
      chainId: 84532,
      userAddress: USER,
      tokenMetadata: { name: 'Rehype', symbol: 'RHP', tokenURI: 'ipfs://rehype' },
      economics: { totalSupply: '1000', tokensForSale: '1000' },
      pricing: { numerairePriceUsd: 3_000 },
      poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '950000000000000000' }],
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
        initializer: {
          type: 'rehype',
          config: {
            rehypeFeeBeneficiaries: [
              { address: BENEFICIARY, sharesWad: '200000000000000000' },
              { address: REHYPE_BENEFICIARY_TWO, sharesWad: '300000000000000000' },
              { address: REHYPE_BENEFICIARY_THREE, sharesWad: '500000000000000000' },
            ],
            startFee: 30_000,
            feeDistributionInfo: {
              assetFeesToAssetBuybackWad: '0',
              assetFeesToNumeraireBuybackWad: '0',
              assetFeesToBeneficiaryWad: '1000000000000000000',
              assetFeesToLpWad: '0',
              numeraireFeesToAssetBuybackWad: '0',
              numeraireFeesToNumeraireBuybackWad: '0',
              numeraireFeesToBeneficiaryWad: '1000000000000000000',
              numeraireFeesToLpWad: '0',
            },
          },
        },
      },
    };

    await captureBuiltParams(input);

    expect(withRehypeSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      feeBeneficiaries: [
        { beneficiary: BENEFICIARY, shares: 200000000000000000n },
        { beneficiary: REHYPE_BENEFICIARY_TWO, shares: 300000000000000000n },
        { beneficiary: REHYPE_BENEFICIARY_THREE, shares: 500000000000000000n },
      ],
    });
    expect(withRehypeSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('buybackDestination');
    expect(withRehypeSpy.mock.calls.at(-1)?.[0]?.feeBeneficiaries).not.toEqual(
      expect.arrayContaining([{ beneficiary: PROTOCOL_OWNER, shares: expect.any(BigInt) }]),
    );
  });

  it('rejects a missing canonical initializer before simulation or submission', async () => {
    const canonicalChain = buildChain(84532);
    const chain = {
      ...canonicalChain,
      addresses: {
        ...canonicalChain.addresses,
        dopplerHookInitializer: undefined,
      },
    } satisfies ChainContext;
    const sdkRegistry = new DopplerSdkRegistry([chain]);
    const sdk = sdkRegistry.get(chain.chainId);
    vi.spyOn(sdk, 'getAirlockOwner').mockResolvedValue(PROTOCOL_OWNER);
    const simulationSpy = vi.spyOn(sdk.factory, 'simulateCreateMulticurve');
    const txSubmitter = new TxSubmitter();
    const submitSpy = vi.spyOn(txSubmitter, 'submitCreateTx');

    await expect(
      createMulticurveLaunch({
        input: buildStandardInput(84532),
        chain,
        sdkRegistry,
        pricingService: new PricingService(pricingConfig),
        txSubmitter,
      }),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'UNSUPPORTED_CHAIN',
    });
    expect(simulationSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
  });
});
