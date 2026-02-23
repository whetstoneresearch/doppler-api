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

describe('governance policy', () => {
  it('defaults to noOp when governance is omitted', () => {
    const resolved = resolveGovernance(undefined, baseChain);
    expect(resolved).toEqual({ type: 'noOp' });
  });

  it('rejects governance=true as not implemented', () => {
    expect(() => resolveGovernance(true, baseChain)).toThrow(/governance is not implemented yet/i);
  });
});
