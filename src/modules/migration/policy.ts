import type {
  BeneficiaryData,
  RehypeDopplerHookMigratorConfig,
} from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../core/errors';
import type { ChainRuntimeConfig } from '../../core/config';
import type { HexAddress, MigrationConfigInput, MigrationType } from '../../core/types';

const PERCENTAGE_TO_WAD = 10n ** 16n;

export type ResolvedMigration =
  | { type: 'noOp' }
  | {
      type: 'uniswapV2Split';
      proceedsSplit?: { recipient: HexAddress; share: bigint };
    }
  | {
      type: 'dopplerHook';
      fee: number;
      tickSpacing: number;
      lockDuration: number;
      beneficiaries: BeneficiaryData[];
      rehype?: RehypeDopplerHookMigratorConfig;
    };

export const resolveMigration = (): ResolvedMigration => ({ type: 'noOp' });

export const resolveRequestedMigration = (args: {
  migration: MigrationConfigInput;
  chainConfig: ChainRuntimeConfig;
  beneficiaries: BeneficiaryData[];
}): ResolvedMigration => {
  const { migration, chainConfig, beneficiaries } = args;
  const mode: MigrationType = migration.type;

  if (!chainConfig.migrationModes.includes(mode)) {
    throw new AppError(
      422,
      'MIGRATION_MODE_UNSUPPORTED',
      `Migration mode ${mode} is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  switch (migration.type) {
    case 'uniswapV2':
      return migration.feeBeneficiary
        ? {
            type: 'uniswapV2Split',
            proceedsSplit: {
              recipient: migration.feeBeneficiary.address,
              share: BigInt(migration.feeBeneficiary.percentage) * PERCENTAGE_TO_WAD,
            },
          }
        : { type: 'uniswapV2Split' };
    case 'uniswapV4':
      return {
        type: 'dopplerHook',
        fee: migration.fee,
        tickSpacing: migration.tickSpacing,
        lockDuration: migration.lockDurationSeconds,
        beneficiaries,
        ...(migration.rehype
          ? {
              rehype: {
                buybackDestination: migration.rehype.buybackDestination,
                customFee: migration.rehype.customFee,
                ...(migration.rehype.feeRoutingMode
                  ? { feeRoutingMode: migration.rehype.feeRoutingMode }
                  : {}),
                feeDistributionInfo: {
                  assetFeesToAssetBuybackWad: BigInt(
                    migration.rehype.feeDistributionInfo.assetFeesToAssetBuybackWad,
                  ),
                  assetFeesToNumeraireBuybackWad: BigInt(
                    migration.rehype.feeDistributionInfo.assetFeesToNumeraireBuybackWad,
                  ),
                  assetFeesToBeneficiaryWad: BigInt(
                    migration.rehype.feeDistributionInfo.assetFeesToBeneficiaryWad,
                  ),
                  assetFeesToLpWad: BigInt(migration.rehype.feeDistributionInfo.assetFeesToLpWad),
                  numeraireFeesToAssetBuybackWad: BigInt(
                    migration.rehype.feeDistributionInfo.numeraireFeesToAssetBuybackWad,
                  ),
                  numeraireFeesToNumeraireBuybackWad: BigInt(
                    migration.rehype.feeDistributionInfo.numeraireFeesToNumeraireBuybackWad,
                  ),
                  numeraireFeesToBeneficiaryWad: BigInt(
                    migration.rehype.feeDistributionInfo.numeraireFeesToBeneficiaryWad,
                  ),
                  numeraireFeesToLpWad: BigInt(
                    migration.rehype.feeDistributionInfo.numeraireFeesToLpWad,
                  ),
                },
              },
            }
          : {}),
      };
  }
};
