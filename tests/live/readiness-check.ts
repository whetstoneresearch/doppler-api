import { parseEther } from 'viem';

export const LIVE_READINESS_ERROR_MARKER = 'LIVE_TEST_READINESS_CHECK_FAILED';
export const DEFAULT_LIVE_ESTIMATED_TX_COST_ETH = '0.000133333333333333';
export const DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH = '0.000133333333333333';
export const DEFAULT_LIVE_ESTIMATED_TX_COST_SOL = '0.025';
export const DEFAULT_LIVE_ESTIMATED_OVERHEAD_SOL = '0.01';
const LAMPORTS_PER_SOL = 1_000_000_000n;

const estimatedLaunchesByFilter: Record<string, { evm: number; solana: number }> = {
  all: { evm: 19, solana: 0 },
  static: { evm: 3, solana: 0 },
  dynamic: { evm: 4, solana: 0 },
  'migration-v2': { evm: 1, solana: 0 },
  'migration-v4': { evm: 1, solana: 0 },
  multicurve: { evm: 12, solana: 0 },
  'multicurve-defaults': { evm: 3, solana: 0 },
  fees: { evm: 3, solana: 0 },
  governance: { evm: 3, solana: 0 },
  negative: { evm: 0, solana: 0 },
  solana: { evm: 0, solana: 4 },
  'solana-devnet': { evm: 0, solana: 4 },
  'solana-defaults': { evm: 0, solana: 2 },
  'solana-random': { evm: 0, solana: 1 },
  'solana-failing': { evm: 0, solana: 0 },
};

const normalizeFilter = (liveFilter: string): string => liveFilter.trim().toLowerCase();
export const isSolanaLiveFilter = (liveFilter: string): boolean => {
  const normalized = normalizeFilter(liveFilter);
  return normalized === 'solana' || normalized.startsWith('solana-');
};

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

const parseSolAmount = (value: string, envName: string): bigint => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,9}))?$/);
  if (!match) {
    throw new Error(
      `${envName} must be a non-negative SOL amount with at most 9 decimal places (received "${value || '(empty)'}")`,
    );
  }

  const whole = BigInt(match[1] ?? '0');
  const fractionalDigits = (match[2] ?? '').padEnd(9, '0');
  return whole * LAMPORTS_PER_SOL + BigInt(fractionalDigits || '0');
};

export const formatSolAmount = (lamports: bigint): string => {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fractional = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole.toString();
};

export const estimateLiveLaunchCount = (liveFilter: string): number => {
  const normalizedFilter = normalizeFilter(liveFilter);
  return (estimatedLaunchesByFilter[normalizedFilter] ?? estimatedLaunchesByFilter.all).evm;
};

export interface LiveBalanceRequirement {
  requiredWei: bigint;
  reason: string;
  estimatedLaunchCount: number;
}

export interface LiveSolanaBalanceRequirement {
  requiredLamports: bigint;
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

export const estimateLiveSolanaLaunchCount = (liveFilter: string): number => {
  const normalizedFilter = normalizeFilter(liveFilter);
  return (estimatedLaunchesByFilter[normalizedFilter] ?? estimatedLaunchesByFilter.all).solana;
};

export const buildLiveSolanaBalanceRequirement = (args: {
  liveFilter: string;
  minBalanceSol?: string;
  estimatedTxCostSol?: string;
  estimatedOverheadSol?: string;
}): LiveSolanaBalanceRequirement | null => {
  const minBalanceOverride = args.minBalanceSol?.trim();
  const estimatedLaunchCount = estimateLiveSolanaLaunchCount(args.liveFilter);

  if (minBalanceOverride) {
    return {
      requiredLamports: parseSolAmount(minBalanceOverride, 'LIVE_TEST_MIN_BALANCE_SOL'),
      reason: `override via LIVE_TEST_MIN_BALANCE_SOL=${minBalanceOverride} SOL`,
      estimatedLaunchCount,
    };
  }

  if (estimatedLaunchCount === 0) {
    return null;
  }

  const estimatedTxCostSol = args.estimatedTxCostSol?.trim() || DEFAULT_LIVE_ESTIMATED_TX_COST_SOL;
  const estimatedOverheadSol =
    args.estimatedOverheadSol?.trim() || DEFAULT_LIVE_ESTIMATED_OVERHEAD_SOL;
  const estimatedTxCostLamports = parseSolAmount(
    estimatedTxCostSol,
    'LIVE_TEST_ESTIMATED_TX_COST_SOL',
  );
  const estimatedOverheadLamports = parseSolAmount(
    estimatedOverheadSol,
    'LIVE_TEST_ESTIMATED_OVERHEAD_SOL',
  );

  return {
    requiredLamports:
      estimatedOverheadLamports + estimatedTxCostLamports * BigInt(estimatedLaunchCount),
    reason: `estimate: ${estimatedLaunchCount} launch tx * ${estimatedTxCostSol} SOL + ${estimatedOverheadSol} SOL overhead`,
    estimatedLaunchCount,
  };
};
