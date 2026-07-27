import { WAD, type BeneficiaryData } from '@whetstone-research/doppler-sdk/evm';
import { describe, expect, it } from 'vitest';

import type { ChainRuntimeConfig } from '../../src/core/config';
import type { MigrationConfigInput, MigrationType } from '../../src/core/types';
import { resolveMigration, resolveRequestedMigration } from '../../src/modules/migration/policy';

const BENEFICIARY = '0x1111111111111111111111111111111111111111';
const BUYBACK_DESTINATION = '0x2222222222222222222222222222222222222222';
const beneficiaries: BeneficiaryData[] = [{ beneficiary: BENEFICIARY, shares: WAD }];
const feeDistributionInfo = {
  assetFeesToAssetBuybackWad: '500000000000000000',
  assetFeesToNumeraireBuybackWad: '500000000000000000',
  assetFeesToBeneficiaryWad: '0',
  assetFeesToLpWad: '0',
  numeraireFeesToAssetBuybackWad: '0',
  numeraireFeesToNumeraireBuybackWad: '0',
  numeraireFeesToBeneficiaryWad: '250000000000000000',
  numeraireFeesToLpWad: '750000000000000000',
} as const;

const baseChain: ChainRuntimeConfig = {
  chainId: 84532,
  rpcUrl: 'https://example-rpc.local',
  defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
  auctionTypes: ['multicurve', 'dynamic'],
  migrationModes: ['noOp', 'uniswapV2', 'uniswapV4'],
  governanceModes: ['noOp'],
  governanceEnabled: false,
};

describe('migration policy', () => {
  it('keeps internal noOp migration for static and multicurve flows', () => {
    expect(resolveMigration()).toEqual({ type: 'noOp' });
  });

  it('maps V2 without a beneficiary to exact uniswapV2Split config', () => {
    expect(
      resolveRequestedMigration({
        migration: { type: 'uniswapV2' },
        chainConfig: baseChain,
        beneficiaries: [],
      }),
    ).toEqual({ type: 'uniswapV2Split' });
  });

  it.each([
    [1, WAD / 100n],
    [50, WAD / 2n],
  ])('maps V2 percentage %s to an exact WAD proceeds split', (percentage, share) => {
    expect(
      resolveRequestedMigration({
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: BENEFICIARY, percentage },
        },
        chainConfig: baseChain,
        beneficiaries: [],
      }),
    ).toEqual({
      type: 'uniswapV2Split',
      proceedsSplit: {
        recipient: BENEFICIARY,
        share,
      },
    });
  });

  it('maps public uniswapV4 to exact SDK dopplerHook config', () => {
    expect(
      resolveRequestedMigration({
        migration: {
          type: 'uniswapV4',
          fee: 30_000,
          tickSpacing: 60,
          lockDurationSeconds: 86_400,
        },
        chainConfig: baseChain,
        beneficiaries,
      }),
    ).toEqual({
      type: 'dopplerHook',
      fee: 30_000,
      tickSpacing: 60,
      lockDuration: 86_400,
      beneficiaries,
    });
  });

  it('maps Rehype migration to the exact SDK config with bigint fee distribution', () => {
    expect(
      resolveRequestedMigration({
        migration: {
          type: 'uniswapV4',
          fee: 3_000,
          tickSpacing: 60,
          lockDurationSeconds: 604_800,
          rehype: {
            buybackDestination: BUYBACK_DESTINATION,
            customFee: 10_000,
            feeRoutingMode: 'routeToBeneficiaryFees',
            feeDistributionInfo,
          },
        },
        chainConfig: baseChain,
        beneficiaries,
      }),
    ).toEqual({
      type: 'dopplerHook',
      fee: 3_000,
      tickSpacing: 60,
      lockDuration: 604_800,
      beneficiaries,
      rehype: {
        buybackDestination: BUYBACK_DESTINATION,
        customFee: 10_000,
        feeRoutingMode: 'routeToBeneficiaryFees',
        feeDistributionInfo: {
          assetFeesToAssetBuybackWad: 500_000_000_000_000_000n,
          assetFeesToNumeraireBuybackWad: 500_000_000_000_000_000n,
          assetFeesToBeneficiaryWad: 0n,
          assetFeesToLpWad: 0n,
          numeraireFeesToAssetBuybackWad: 0n,
          numeraireFeesToNumeraireBuybackWad: 0n,
          numeraireFeesToBeneficiaryWad: 250_000_000_000_000_000n,
          numeraireFeesToLpWad: 750_000_000_000_000_000n,
        },
      },
    });
  });

  const unsupportedCases: readonly {
    migration: MigrationConfigInput;
    migrationModes: MigrationType[];
  }[] = [
    { migration: { type: 'uniswapV2' as const }, migrationModes: ['noOp', 'uniswapV4'] },
    {
      migration: {
        type: 'uniswapV4' as const,
        fee: 0,
        tickSpacing: 1,
        lockDurationSeconds: 0,
      },
      migrationModes: ['noOp', 'uniswapV2'],
    },
  ];

  it.each(unsupportedCases)(
    'rejects a dynamic migration disabled for the chain',
    ({ migration, migrationModes }) => {
      const chainConfig = { ...baseChain, migrationModes } satisfies ChainRuntimeConfig;
      expect(() =>
        resolveRequestedMigration({ migration, chainConfig, beneficiaries }),
      ).toThrowError(
        expect.objectContaining({
          statusCode: 422,
          code: 'MIGRATION_MODE_UNSUPPORTED',
        }),
      );
    },
  );
});
