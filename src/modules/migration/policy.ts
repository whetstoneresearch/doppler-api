import { AppError } from '../../core/errors';
import type { MigrationConfigInput, MigrationType } from '../../core/types';
import type { ChainRuntimeConfig } from '../../core/config';

export type ResolvedMigration =
  | { type: 'noOp' }
  | { type: 'uniswapV2' }
  | { type: 'uniswapV4'; fee: number; tickSpacing: number };

export const resolveMigration = (
  migration: MigrationConfigInput,
  chainConfig: ChainRuntimeConfig,
): ResolvedMigration => {
  const mode: MigrationType = migration.type;

  if (mode === 'uniswapV2' || mode === 'uniswapV3' || mode === 'uniswapV4') {
    throw new AppError(
      501,
      'MIGRATION_NOT_IMPLEMENTED',
      `${mode} migration is not implemented yet and is coming soon`,
    );
  }

  if (!chainConfig.migrationModes.includes(mode)) {
    throw new AppError(
      422,
      'MIGRATION_MODE_UNSUPPORTED',
      `Migration mode ${mode} is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  if (mode === 'noOp') {
    return { type: 'noOp' };
  }

  if (mode === 'uniswapV2') {
    throw new AppError(
      501,
      'MIGRATION_NOT_IMPLEMENTED',
      'uniswapV2 migration is not implemented yet',
    );
  }

  throw new AppError(
    501,
    'MIGRATION_NOT_IMPLEMENTED',
    'uniswapV4 migration is not implemented yet',
  );
};

export const resolveDynamicMigration = (
  migration: MigrationConfigInput,
  chainConfig: ChainRuntimeConfig,
): ResolvedMigration => {
  const mode: MigrationType = migration.type;

  if (mode === 'uniswapV3') {
    throw new AppError(
      501,
      'MIGRATION_NOT_IMPLEMENTED',
      'uniswapV3 migration is not implemented; dynamic launches currently support uniswapV2 and uniswapV4',
    );
  }

  if (!chainConfig.migrationModes.includes(mode)) {
    throw new AppError(
      422,
      'MIGRATION_MODE_UNSUPPORTED',
      `Migration mode ${mode} is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  if (mode === 'uniswapV2') {
    return { type: 'uniswapV2' };
  }

  if (migration.type === 'uniswapV4') {
    return {
      type: 'uniswapV4',
      fee: migration.fee,
      tickSpacing: migration.tickSpacing,
    };
  }

  throw new AppError(
    422,
    'MIGRATION_MODE_UNSUPPORTED',
    'dynamic launches require migration.type="uniswapV2" or "uniswapV4"',
  );
};
