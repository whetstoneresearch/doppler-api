import { AppError } from '../../core/errors';
import type { ChainRuntimeConfig } from '../../core/config';
import type { GovernanceMode, HexAddress } from '../../core/types';

export type ResolvedGovernance =
  | { type: 'noOp' }
  | { type: 'default' }
  | { type: 'launchpad'; multisig: HexAddress };

export const resolveGovernance = (
  governance: boolean | HexAddress | undefined,
  chainConfig: ChainRuntimeConfig,
): ResolvedGovernance => {
  const mode: GovernanceMode =
    typeof governance === 'string' ? 'launchpad' : governance === true ? 'default' : 'noOp';

  if (
    !chainConfig.governanceModes.includes(mode) ||
    (mode !== 'noOp' && !chainConfig.governanceEnabled)
  ) {
    throw new AppError(
      422,
      'GOVERNANCE_MODE_UNSUPPORTED',
      `Governance mode ${mode} is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  if (typeof governance === 'string') {
    return { type: 'launchpad', multisig: governance };
  }

  return governance === true ? { type: 'default' } : { type: 'noOp' };
};
