import { AppError } from '../../core/errors';
import type { GovernanceConfig } from '../../core/types';
import type { ChainRuntimeConfig } from '../../core/config';

export type ResolvedGovernance =
  | { type: 'noOp' }
  | { type: 'default' }
  | {
      type: 'custom';
      initialVotingDelay: number;
      initialVotingPeriod: number;
      initialProposalThreshold: bigint;
    };

export const resolveGovernance = (
  governance: GovernanceConfig | boolean | undefined,
  chainConfig: ChainRuntimeConfig,
): ResolvedGovernance => {
  const normalized: GovernanceConfig =
    typeof governance === 'boolean'
      ? governance
        ? { enabled: true, mode: 'default' }
        : { enabled: false, mode: 'noOp' }
      : (governance ?? { enabled: false, mode: 'noOp' });

  const mode = normalized.mode ?? (normalized.enabled ? 'default' : 'noOp');

  if (mode === 'noOp' && !normalized.enabled) {
    if (!chainConfig.governanceModes.includes(mode)) {
      throw new AppError(
        422,
        'GOVERNANCE_MODE_UNSUPPORTED',
        `Governance mode ${mode} is not enabled for chain ${chainConfig.chainId}`,
      );
    }
    return { type: 'noOp' };
  }

  if (mode === 'noOp' && normalized.enabled) {
    throw new AppError(
      422,
      'GOVERNANCE_MODE_UNSUPPORTED',
      'governance.mode=noOp requires enabled=false',
    );
  }

  throw new AppError(
    501,
    'GOVERNANCE_NOT_IMPLEMENTED',
    'Governance is not implemented yet; use governance=false (noOp)',
  );
};
