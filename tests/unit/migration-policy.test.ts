import { describe, expect, it } from 'vitest';

import type { ChainRuntimeConfig } from '../../src/core/config';
import { resolveDynamicMigration, resolveMigration } from '../../src/modules/migration/policy';

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
  it('keeps noOp migration for multicurve/static flows', () => {
    expect(resolveMigration({ type: 'noOp' }, baseChain)).toEqual({ type: 'noOp' });
  });

  it('enables uniswapV2 migration for dynamic flows', () => {
    expect(resolveDynamicMigration({ type: 'uniswapV2' }, baseChain)).toEqual({
      type: 'uniswapV2',
    });
  });

  it('enables uniswapV4 migration for dynamic flows', () => {
    expect(
      resolveDynamicMigration({ type: 'uniswapV4', fee: 10_000, tickSpacing: 200 }, baseChain),
    ).toEqual({
      type: 'uniswapV4',
      fee: 10_000,
      tickSpacing: 200,
    });
  });

  it('rejects dynamic noOp migration', () => {
    expect(() => resolveDynamicMigration({ type: 'noOp' }, baseChain)).toThrow(
      /dynamic launches require migration\.type="uniswapV2" or "uniswapV4"/i,
    );
  });

  it('rejects uniswapV3 migration with 501-compatible message', () => {
    expect(() => resolveMigration({ type: 'uniswapV3' }, baseChain)).toThrow(
      /uniswapV3 migration is not implemented/i,
    );
    expect(() => resolveDynamicMigration({ type: 'uniswapV3' }, baseChain)).toThrow(
      /uniswapV3 migration is not implemented/i,
    );
  });
});
