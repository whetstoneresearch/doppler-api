import { parseEther } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  buildLiveBalanceRequirement,
  DEFAULT_LIVE_ESTIMATED_OVERHEAD_ETH,
  DEFAULT_LIVE_ESTIMATED_TX_COST_ETH,
  estimateLiveLaunchCount,
} from '../live/readiness-check';

describe('live readiness check', () => {
  it('estimates launch counts by live filter', () => {
    expect(estimateLiveLaunchCount('all')).toBe(14);
    expect(estimateLiveLaunchCount('static')).toBe(2);
    expect(estimateLiveLaunchCount('dynamic')).toBe(1);
    expect(estimateLiveLaunchCount('multicurve')).toBe(11);
    expect(estimateLiveLaunchCount('multicurve-defaults')).toBe(3);
    expect(estimateLiveLaunchCount('governance')).toBe(3);
    expect(estimateLiveLaunchCount('negative')).toBe(0);
  });

  it('falls back to all estimate for unknown filters', () => {
    expect(estimateLiveLaunchCount('unknown-filter')).toBe(14);
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

  it('throws for invalid minimum balance values', () => {
    expect(() =>
      buildLiveBalanceRequirement({
        liveFilter: 'all',
        minBalanceEth: 'not-a-number',
      }),
    ).toThrow(/LIVE_TEST_MIN_BALANCE_ETH/);
  });
});
