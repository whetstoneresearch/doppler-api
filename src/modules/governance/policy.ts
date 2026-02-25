import { AppError } from '../../core/errors';
import type { GovernanceConfig } from '../../core/types';
import type { ChainRuntimeConfig } from '../../core/config';

export type ResolvedGovernance = { type: 'noOp' } | { type: 'default' };

export const resolveGovernance = (
  governance: GovernanceConfig | boolean | undefined,
  chainConfig: ChainRuntimeConfig,
): ResolvedGovernance => {
  const enabled = typeof governance === 'boolean' ? governance : (governance?.enabled ?? false);
  const explicitMode = typeof governance === 'object' ? governance.mode : undefined;
  const resolvedMode = enabled ? 'default' : 'noOp';

  if (explicitMode && explicitMode !== resolvedMode) {
    throw new AppError(
      422,
      'GOVERNANCE_MODE_UNSUPPORTED',
      'governance supports only binary mode: enabled=true (default) or enabled=false (noOp)',
    );
  }

  if (!chainConfig.governanceModes.includes(resolvedMode)) {
    throw new AppError(
      422,
      'GOVERNANCE_MODE_UNSUPPORTED',
      `Governance mode ${resolvedMode} is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  if (enabled && !chainConfig.governanceEnabled) {
    throw new AppError(
      422,
      'GOVERNANCE_MODE_UNSUPPORTED',
      `Governance is not enabled for chain ${chainConfig.chainId}`,
    );
  }

  return { type: resolvedMode };
};
