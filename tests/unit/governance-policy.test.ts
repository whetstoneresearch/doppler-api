import { describe, expect, it } from 'vitest';

import type { ChainRuntimeConfig } from '../../src/core/config';
import type { GovernanceMode, HexAddress } from '../../src/core/types';
import { resolveGovernance, type ResolvedGovernance } from '../../src/modules/governance/policy';

const MULTISIG: HexAddress = '0x1111111111111111111111111111111111111111';

const governedChain: ChainRuntimeConfig = {
  chainId: 84532,
  rpcUrl: 'https://example-rpc.local',
  defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
  auctionTypes: ['multicurve'],
  migrationModes: ['noOp'],
  governanceModes: ['noOp', 'default', 'launchpad'],
  governanceEnabled: true,
};

describe('governance policy', () => {
  const resolutionCases: readonly {
    input: boolean | HexAddress | undefined;
    expected: ResolvedGovernance;
  }[] = [
    { input: undefined, expected: { type: 'noOp' } },
    { input: false, expected: { type: 'noOp' } },
    { input: true, expected: { type: 'default' } },
    { input: MULTISIG, expected: { type: 'launchpad', multisig: MULTISIG } },
  ];

  it.each(resolutionCases)(
    'resolves $input to the exact SDK governance object',
    ({ input, expected }) => {
      expect(resolveGovernance(input, governedChain)).toEqual(expected);
    },
  );

  const unsupportedCases: readonly {
    input: boolean | HexAddress;
    modes: GovernanceMode[];
  }[] = [
    { input: false, modes: ['default', 'launchpad'] },
    { input: true, modes: ['noOp', 'launchpad'] },
    { input: MULTISIG, modes: ['noOp', 'default'] },
  ];

  it.each(unsupportedCases)(
    'rejects a governance mode disabled for the chain',
    ({ input, modes }) => {
      const chain = { ...governedChain, governanceModes: modes } satisfies ChainRuntimeConfig;
      expect(() => resolveGovernance(input, chain)).toThrowError(
        expect.objectContaining({
          statusCode: 422,
          code: 'GOVERNANCE_MODE_UNSUPPORTED',
        }),
      );
    },
  );
});
