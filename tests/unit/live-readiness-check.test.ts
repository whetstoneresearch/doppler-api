import { readFileSync } from 'node:fs';
import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildLiveBalanceRequirement,
  buildLiveSolanaBalanceRequirement,
  DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH,
  DEFAULT_LIVE_ESTIMATED_OVERHEAD_SOL,
  DEFAULT_LIVE_ESTIMATED_TX_COST_ETH,
  DEFAULT_LIVE_ESTIMATED_TX_COST_SOL,
  estimateLiveSolanaLaunchCount,
  formatSolAmount,
  isSolanaLiveFilter,
  estimateLiveLaunchCount,
} from '../live/readiness-check';

describe('live readiness check', () => {
  it('estimates launch counts by live filter', () => {
    expect(estimateLiveLaunchCount('all')).toBe(19);
    expect(estimateLiveLaunchCount('static')).toBe(3);
    expect(estimateLiveLaunchCount('dynamic')).toBe(4);
    expect(estimateLiveLaunchCount('migration-v2')).toBe(1);
    expect(estimateLiveLaunchCount('migration-v4')).toBe(1);
    expect(estimateLiveLaunchCount('multicurve')).toBe(12);
    expect(estimateLiveLaunchCount('multicurve-defaults')).toBe(3);
    expect(estimateLiveLaunchCount('fees')).toBe(3);
    expect(estimateLiveLaunchCount('governance')).toBe(3);
    expect(estimateLiveLaunchCount('negative')).toBe(0);
  });

  it('falls back to all estimate for unknown filters', () => {
    expect(estimateLiveLaunchCount('unknown-filter')).toBe(19);
  });

  it('estimates Solana launch counts and filter detection', () => {
    expect(estimateLiveSolanaLaunchCount('solana')).toBe(17);
    expect(estimateLiveSolanaLaunchCount('solana-devnet')).toBe(17);
    expect(estimateLiveSolanaLaunchCount('solana-defaults')).toBe(3);
    expect(estimateLiveSolanaLaunchCount('solana-fees')).toBe(1);
    expect(estimateLiveSolanaLaunchCount('solana-cpmm')).toBe(2);
    expect(estimateLiveSolanaLaunchCount('solana-no-migration')).toBe(3);
    expect(estimateLiveSolanaLaunchCount('solana-random')).toBe(3);
    expect(estimateLiveSolanaLaunchCount('solana-cosigner')).toBe(2);
    expect(estimateLiveSolanaLaunchCount('solana-failing')).toBe(0);
    expect(isSolanaLiveFilter('solana')).toBe(true);
    expect(isSolanaLiveFilter('solana-devnet')).toBe(true);
    expect(isSolanaLiveFilter('multicurve')).toBe(false);
  });

  it('keeps Solana live scripts aligned with readiness filters', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    const expectedSolanaScripts = {
      'test:live:solana': 'solana',
      'test:live:solana:devnet': 'solana-devnet',
      'test:live:solana:defaults': 'solana-defaults',
      'test:live:solana:fees': 'solana-fees',
      'test:live:solana:cpmm': 'solana-cpmm',
      'test:live:solana:no-migration': 'solana-no-migration',
      'test:live:solana:random': 'solana-random',
      'test:live:solana:cosigner': 'solana-cosigner',
      'test:live:solana:failing': 'solana-failing',
    };

    for (const [scriptName, liveFilter] of Object.entries(expectedSolanaScripts)) {
      expect(packageJson.scripts[scriptName]).toContain('LIVE_TEST_ENABLE=true');
      expect(packageJson.scripts[scriptName]).toContain(`LIVE_TEST_FILTER=${liveFilter}`);
      expect(packageJson.scripts[scriptName]).toContain('tests/live/create-and-verify.test.ts');
    }
  });

  it('computes estimated required wei using defaults', () => {
    const requirement = buildLiveBalanceRequirement({
      liveFilter: 'multicurve-defaults',
    });

    expect(requirement).not.toBeNull();
    expect(requirement!.requiredWei).toBe(
      parseEther(DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH) +
        parseEther(DEFAULT_LIVE_ESTIMATED_TX_COST_ETH) * 3n,
    );
    expect(requirement!.reason).toContain('estimate: 3 launch tx');
  });

  it('returns null for zero-launch filters without explicit minimum', () => {
    const requirement = buildLiveBalanceRequirement({
      liveFilter: 'negative',
    });
    expect(requirement).toBeNull();
  });

  it('honors explicit minimum balance override', () => {
    const requirement = buildLiveBalanceRequirement({
      liveFilter: 'negative',
      minBalanceEth: '0.25',
    });

    expect(requirement).not.toBeNull();
    expect(requirement!.requiredWei).toBe(parseEther('0.25'));
    expect(requirement!.reason).toContain('LIVE_TEST_MIN_BALANCE_ETH=0.25');
  });

  it('computes estimated required lamports using Solana defaults', () => {
    const requirement = buildLiveSolanaBalanceRequirement({
      liveFilter: 'solana-defaults',
    });

    expect(requirement).not.toBeNull();
    expect(formatSolAmount(requirement!.requiredLamports)).toBe(formatSolAmount(85_000_000n));
    expect(requirement!.reason).toContain(
      `estimate: 3 launch tx * ${DEFAULT_LIVE_ESTIMATED_TX_COST_SOL} SOL + ${DEFAULT_LIVE_ESTIMATED_OVERHEAD_SOL} SOL overhead`,
    );
  });

  it('honors explicit minimum Solana balance override', () => {
    const requirement = buildLiveSolanaBalanceRequirement({
      liveFilter: 'solana-failing',
      minBalanceSol: '0.5',
    });

    expect(requirement).not.toBeNull();
    expect(formatSolAmount(requirement!.requiredLamports)).toBe('0.5');
    expect(requirement!.reason).toContain('LIVE_TEST_MIN_BALANCE_SOL=0.5');
  });

  it('throws for invalid minimum balance values', () => {
    expect(() =>
      buildLiveBalanceRequirement({
        liveFilter: 'all',
        minBalanceEth: 'not-a-number',
      }),
    ).toThrow(/LIVE_TEST_MIN_BALANCE_ETH/);
  });

  it('throws for invalid minimum Solana balance values', () => {
    expect(() =>
      buildLiveSolanaBalanceRequirement({
        liveFilter: 'solana',
        minBalanceSol: 'not-a-number',
      }),
    ).toThrow(/LIVE_TEST_MIN_BALANCE_SOL/);
  });
});
