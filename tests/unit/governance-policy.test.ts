import { describe, expect, it } from 'vitest';

import { resolveGovernance } from '../../src/modules/governance/policy';
import type { ChainRuntimeConfig } from '../../src/core/config';

const baseChain: ChainRuntimeConfig = {
  chainId: 84532,
  rpcUrl: 'https://example-rpc.local',
  defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
  auctionTypes: ['multicurve'],
  migrationModes: ['noOp'],
  governanceModes: ['noOp'],
  governanceEnabled: false,
};

const governedChain: ChainRuntimeConfig = {
  ...baseChain,
  governanceModes: ['noOp', 'default'],
  governanceEnabled: true,
};

describe('governance policy', () => {
  it('defaults to noOp when governance is omitted', () => {
    const resolved = resolveGovernance(undefined, baseChain);
    expect(resolved).toEqual({ type: 'noOp' });
  });

  it('resolves governance=true to default when enabled for chain', () => {
    const resolved = resolveGovernance(true, governedChain);
    expect(resolved).toEqual({ type: 'default' });
  });

  it('resolves governance object enabled=true to default', () => {
    const resolved = resolveGovernance({ enabled: true }, governedChain);
    expect(resolved).toEqual({ type: 'default' });
  });

  it('rejects governance=true when default governance is disabled on chain', () => {
    expect(() => resolveGovernance(true, baseChain)).toThrow(
      /governance mode default is not enabled/i,
    );
  });

  it('rejects non-binary governance mode configuration', () => {
    expect(() => resolveGovernance({ enabled: true, mode: 'custom' }, governedChain)).toThrow(
      /binary mode/i,
    );
  });
});
