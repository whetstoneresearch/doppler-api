import { getAddresses, WAD } from '@whetstone-research/doppler-sdk/evm';
import { describe, expect, it, vi } from 'vitest';

import type { ChainRuntimeConfig } from '../../src/core/config';
import { createDynamicLaunch } from '../../src/modules/auctions/dynamic/service';
import type { CreateDynamicLaunchRequestInput } from '../../src/modules/launches/schema';

const USER = '0x1111111111111111111111111111111111111111';
const INTEGRATOR = '0x2222222222222222222222222222222222222222';
const BENEFICIARY = '0x3333333333333333333333333333333333333333';
const CONTROLLER = '0x4444444444444444444444444444444444444444';
const EXCLUDED = '0x5555555555555555555555555555555555555555';
const PROTOCOL_OWNER = '0x9999999999999999999999999999999999999999';
const V4_INITIALIZER = '0x53b4c21a6Cb61D64F636ABBfa6E8E90E6558e8ad';
const V2_MIGRATOR_SPLIT = '0xD7abA5f1d80a330a6fe9E96F7bA122710E0912d3';
const DOPPLER_HOOK_MIGRATOR = '0x1E40b0875DDa35f41E15cFB475403859B8c860c4';
const REHYPE_DOPPLER_HOOK_MIGRATOR = '0x7777777777777777777777777777777777777777';
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const POOL_ID = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const BASIC_TOKEN_CONFIG = {
  type: 'dopplerERC20V1',
  name: 'Dynamic',
  symbol: 'DYN',
  tokenURI: 'ipfs://token',
} as const;

const createInput = (
  migration: CreateDynamicLaunchRequestInput['migration'],
): CreateDynamicLaunchRequestInput => ({
  chainId: 84532,
  userAddress: USER,
  integrationAddress: INTEGRATOR,
  tokenMetadata: { name: 'Dynamic', symbol: 'DYN', tokenURI: 'ipfs://token' },
  economics: {
    totalSupply: '1000',
    tokensForSale: '800',
    allocations: [
      {
        recipientAddress: USER,
        amount: '200',
        durationSeconds: 86_400,
        cliffDurationSeconds: 3_600,
      },
    ],
  },
  migration,
  governance: true,
  auction: {
    type: 'dynamic',
    curveConfig: {
      type: 'range',
      marketCapStartUsd: 100,
      marketCapMinUsd: 50,
      minProceeds: '0.01',
      maxProceeds: '0.1',
      durationSeconds: 86_400,
    },
  },
});

const createFixture = () => {
  const builtParams = { canonical: 'dynamic-params' };
  const builder = {
    tokenConfig: vi.fn().mockReturnThis(),
    saleConfig: vi.fn().mockReturnThis(),
    withMarketCapRange: vi.fn().mockReturnThis(),
    withIntegrator: vi.fn().mockReturnThis(),
    withVesting: vi.fn().mockReturnThis(),
    withGovernance: vi.fn().mockReturnThis(),
    withMigration: vi.fn().mockReturnThis(),
    withUserAddress: vi.fn().mockReturnThis(),
    withV4Initializer: vi.fn().mockReturnThis(),
    withV2MigratorSplit: vi.fn().mockReturnThis(),
    withDopplerHookMigrator: vi.fn().mockReturnThis(),
    withRehypeDopplerHookMigrator: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue(builtParams),
  };
  const simulation = {
    createParams: { salt: '0x03' },
    tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    poolId: POOL_ID,
    gasEstimate: 789n,
  };
  const sdk = {
    buildDynamicAuction: vi.fn(() => builder),
    getAirlockOwner: vi.fn().mockResolvedValue(PROTOCOL_OWNER),
    factory: {
      simulateCreateDynamicAuction: vi.fn().mockResolvedValue(simulation),
    },
  };
  const chain = {
    chainId: 84532,
    config: {
      chainId: 84532,
      rpcUrl: 'http://localhost:8545',
      defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
      auctionTypes: ['dynamic'],
      migrationModes: ['uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    } satisfies ChainRuntimeConfig,
    addresses: {
      ...getAddresses(84532),
      airlock: '0x0000000000000000000000000000000000000001',
      weth: '0x4200000000000000000000000000000000000006',
      v4Initializer: V4_INITIALIZER,
      v2MigratorSplit: V2_MIGRATOR_SPLIT,
      dopplerHookMigrator: DOPPLER_HOOK_MIGRATOR,
      rehypeDopplerHookMigrator: REHYPE_DOPPLER_HOOK_MIGRATOR,
    } satisfies ReturnType<typeof getAddresses>,
    publicClient: {
      getBytecode: vi.fn().mockResolvedValue(undefined),
      simulateContract: vi.fn().mockResolvedValue({ request: { to: '0xairlock' } }),
    },
    walletClient: {
      account: {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
        type: 'json-rpc' as const,
      },
    },
  };
  const pricingService = { resolveNumerairePriceUsd: vi.fn().mockResolvedValue(3000) };
  const txSubmitter = { submitCreateTx: vi.fn().mockResolvedValue(TX_HASH) };

  const launch = (input: CreateDynamicLaunchRequestInput) => {
    const args = {
      input,
      chain,
      sdkRegistry: { get: vi.fn().mockReturnValue(sdk) },
      pricingService,
      txSubmitter,
    };
    return createDynamicLaunch(args);
  };

  return { builder, builtParams, chain, launch, sdk, txSubmitter };
};

describe('dynamic launch service', () => {
  it('builds canonical UniswapV2MigratorSplit without a fee beneficiary', async () => {
    // Given
    const fixture = createFixture();
    const input = createInput({ type: 'uniswapV2' });

    // When
    const response = await fixture.launch(input);

    // Then
    expect(fixture.builder.tokenConfig).toHaveBeenCalledWith(BASIC_TOKEN_CONFIG);
    expect(fixture.builder.withV4Initializer).toHaveBeenCalledWith(V4_INITIALIZER);
    expect(fixture.builder.withV2MigratorSplit).toHaveBeenCalledWith(V2_MIGRATOR_SPLIT);
    expect(fixture.builder.withDopplerHookMigrator).not.toHaveBeenCalled();
    expect(fixture.builder.withMigration).toHaveBeenCalledWith({ type: 'uniswapV2Split' });
    expect(fixture.builder.withGovernance).toHaveBeenCalledWith({ type: 'default' });
    expect(fixture.builder.withVesting).toHaveBeenCalledWith({
      allocations: [
        {
          recipient: USER,
          amount: 200n,
          schedule: { duration: 86_400n, cliffDuration: 3_600 },
        },
      ],
    });
    expect(fixture.sdk.factory.simulateCreateDynamicAuction).toHaveBeenCalledWith(
      fixture.builtParams,
    );
    expect(fixture.chain.publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0x0000000000000000000000000000000000000001',
        functionName: 'create',
        blockTag: 'pending',
        args: [{ salt: '0x03' }],
      }),
    );
    expect(fixture.txSubmitter.submitCreateTx).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { to: '0xairlock' },
        gasEstimate: 789n,
      }),
    );
    expect(response.effectiveConfig.poolFeeBeneficiariesSource).toBe('none');
  });

  it.each([
    [1, 10_000_000_000_000_000n],
    [50, 500_000_000_000_000_000n],
  ])(
    'maps UniswapV2MigratorSplit fee beneficiary percentage %s to WAD',
    async (percentage, shareWad) => {
      // Given
      const fixture = createFixture();
      const input = createInput({
        type: 'uniswapV2',
        feeBeneficiary: { address: BENEFICIARY, percentage },
      });

      // When
      const response = await fixture.launch(input);

      // Then
      expect(fixture.builder.tokenConfig).toHaveBeenCalledWith(BASIC_TOKEN_CONFIG);
      expect(fixture.builder.withV4Initializer).toHaveBeenCalledWith(V4_INITIALIZER);
      expect(fixture.builder.withV2MigratorSplit).toHaveBeenCalledWith(V2_MIGRATOR_SPLIT);
      expect(fixture.builder.withMigration).toHaveBeenCalledWith({
        type: 'uniswapV2Split',
        proceedsSplit: {
          recipient: BENEFICIARY,
          share: shareWad,
        },
      });
      expect(response.effectiveConfig.poolFeeBeneficiariesSource).toBe('none');
    },
  );

  it('maps public uniswapV4 to the canonical DopplerHookMigrator', async () => {
    // Given
    const fixture = createFixture();
    const input = {
      ...createInput({
        type: 'uniswapV4',
        fee: 30_000,
        tickSpacing: 60,
        lockDurationSeconds: 172_800,
      }),
      governance: CONTROLLER,
      tokenMetadata: {
        name: 'Dynamic',
        symbol: 'DYN',
        tokenURI: 'ipfs://token',
        maxBalanceLimit: '123',
        balanceLimitEnd: 999,
        balanceController: CONTROLLER,
        excludedFromBalanceLimit: [EXCLUDED],
      },
      poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: ((WAD * 95n) / 100n).toString() }],
    } satisfies CreateDynamicLaunchRequestInput;

    // When
    const response = await fixture.launch(input);

    // Then
    expect(fixture.builder.tokenConfig).toHaveBeenCalledWith({
      type: 'dopplerERC20V1',
      name: 'Dynamic',
      symbol: 'DYN',
      tokenURI: 'ipfs://token',
      maxBalanceLimit: 123n,
      balanceLimitEnd: 999,
      controller: CONTROLLER,
      excludedFromBalanceLimit: [EXCLUDED],
    });
    expect(fixture.builder.withV4Initializer).toHaveBeenCalledWith(V4_INITIALIZER);
    expect(fixture.builder.withDopplerHookMigrator).toHaveBeenCalledWith(DOPPLER_HOOK_MIGRATOR);
    expect(fixture.builder.withV2MigratorSplit).not.toHaveBeenCalled();
    expect(fixture.builder.withMigration).toHaveBeenCalledWith({
      type: 'dopplerHook',
      fee: 30_000,
      tickSpacing: 60,
      lockDuration: 172_800,
      beneficiaries: [
        { beneficiary: BENEFICIARY, shares: (WAD * 95n) / 100n },
        { beneficiary: PROTOCOL_OWNER, shares: (WAD * 5n) / 100n },
      ],
    });
    expect(fixture.builder.withGovernance).toHaveBeenCalledWith({
      type: 'launchpad',
      multisig: CONTROLLER,
    });
    expect(response.effectiveConfig.poolFeeBeneficiariesSource).toBe('request');
  });

  it('selects RehypeDopplerHookMigrator and preserves separate LP and Rehype fees', async () => {
    const fixture = createFixture();
    const feeDistributionInfo = {
      assetFeesToAssetBuybackWad: '1000000000000000000',
      assetFeesToNumeraireBuybackWad: '0',
      assetFeesToBeneficiaryWad: '0',
      assetFeesToLpWad: '0',
      numeraireFeesToAssetBuybackWad: '0',
      numeraireFeesToNumeraireBuybackWad: '0',
      numeraireFeesToBeneficiaryWad: '500000000000000000',
      numeraireFeesToLpWad: '500000000000000000',
    } as const;
    const input = createInput({
      type: 'uniswapV4',
      fee: 3_000,
      tickSpacing: 60,
      lockDurationSeconds: 604_800,
      rehype: {
        buybackDestination: BENEFICIARY,
        customFee: 10_000,
        feeRoutingMode: 'directBuyback',
        feeDistributionInfo,
      },
    });

    await fixture.launch(input);

    expect(fixture.builder.withDopplerHookMigrator).toHaveBeenCalledWith(DOPPLER_HOOK_MIGRATOR);
    expect(fixture.builder.withRehypeDopplerHookMigrator).toHaveBeenCalledWith(
      REHYPE_DOPPLER_HOOK_MIGRATOR,
    );
    expect(fixture.builder.withMigration).toHaveBeenCalledWith({
      type: 'dopplerHook',
      fee: 3_000,
      tickSpacing: 60,
      lockDuration: 604_800,
      beneficiaries: [
        { beneficiary: USER, shares: (WAD * 95n) / 100n },
        { beneficiary: PROTOCOL_OWNER, shares: (WAD * 5n) / 100n },
      ],
      rehype: {
        buybackDestination: BENEFICIARY,
        customFee: 10_000,
        feeRoutingMode: 'directBuyback',
        feeDistributionInfo: {
          assetFeesToAssetBuybackWad: WAD,
          assetFeesToNumeraireBuybackWad: 0n,
          assetFeesToBeneficiaryWad: 0n,
          assetFeesToLpWad: 0n,
          numeraireFeesToAssetBuybackWad: 0n,
          numeraireFeesToNumeraireBuybackWad: 0n,
          numeraireFeesToBeneficiaryWad: WAD / 2n,
          numeraireFeesToLpWad: WAD / 2n,
        },
      },
    });
  });

  it('rejects poolFeeBeneficiaries for uniswapV2 before simulation or submission', async () => {
    // Given
    const fixture = createFixture();
    const input = {
      ...createInput({ type: 'uniswapV2' }),
      poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: WAD.toString() }],
    } satisfies CreateDynamicLaunchRequestInput;

    // When
    const result = fixture.launch(input);

    // Then
    await expect(result).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_REQUEST',
    });
    expect(fixture.sdk.factory.simulateCreateDynamicAuction).not.toHaveBeenCalled();
    expect(fixture.txSubmitter.submitCreateTx).not.toHaveBeenCalled();
  });
});
