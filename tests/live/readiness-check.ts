import { parseEther } from 'viem';

export const LIVE_READINESS_ERROR_MARKER = 'LIVE_TEST_READINESS_CHECK_FAILED';
export const DEFAULT_LIVE_ESTIMATED_TX_COST_ETH = '0.000133333333333333';
export const DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH = '0.000133333333333333';

const estimatedLaunchesByFilter: Record<string, number> = {
  all: 14,
  static: 2,
  dynamic: 1,
  multicurve: 11,
  'multicurve-defaults': 3,
  governance: 3,
  negative: 0,
};

const normalizeFilter = (liveFilter: string): string => liveFilter.trim().toLowerCase();

const parseEthAmount = (value: string, envName: string): bigint => {
  try {
    const parsed = parseEther(value);
    if (parsed < 0n) {
      throw new Error('value must be non-negative');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `${envName} must be a non-negative ETH amount (received "${value || '(empty)'}")`,
      {
        cause: error as Error,
      },
    );
  }
};

export const estimateLiveLaunchCount = (liveFilter: string): number => {
  const normalizedFilter = normalizeFilter(liveFilter);
  return estimatedLaunchesByFilter[normalizedFilter] ?? estimatedLaunchesByFilter.all;
};

export interface LiveBalanceRequirement {
  requiredWei: bigint;
  reason: string;
  estimatedLaunchCount: number;
}

export const buildLiveBalanceRequirement = (args: {
  liveFilter: string;
  minBalanceEth?: string;
  estimatedTxCostEth?: string;
  estimatedOverheadEth?: string;
}): LiveBalanceRequirement | null => {
  const minBalanceOverride = args.minBalanceEth?.trim();
  const estimatedLaunchCount = estimateLiveLaunchCount(args.liveFilter);

  if (minBalanceOverride) {
    return {
      requiredWei: parseEthAmount(minBalanceOverride, 'LIVE_TEST_MIN_BALANCE_ETH'),
      reason: `override via LIVE_TEST_MIN_BALANCE_ETH=${minBalanceOverride} ETH`,
      estimatedLaunchCount,
    };
  }

  if (estimatedLaunchCount === 0) {
    return null;
  }

  const estimatedTxCostEth = args.estimatedTxCostEth?.trim() || DEFAULT_LIVE_ESTIMATED_TX_COST_ETH;
  const estimatedOverheadEth =
    args.estimatedOverheadEth?.trim() || DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH;
  const estimatedTxCostWei = parseEthAmount(estimatedTxCostEth, 'LIVE_TEST_ESTIMATED_TX_COST_ETH');
  const estimatedOverheadWei = parseEthAmount(
    estimatedOverheadEth,
    'LIVE_TEST_ESTIMATED_OVERHEAD_ETH',
  );

  return {
    requiredWei: estimatedOverheadWei + estimatedTxCostWei * BigInt(estimatedLaunchCount),
    reason: `estimate: ${estimatedLaunchCount} launch tx * ${estimatedTxCostEth} ETH + ${estimatedOverheadEth} ETH overhead`,
    estimatedLaunchCount,
  };
};
