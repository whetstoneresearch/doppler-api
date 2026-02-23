import { describe, expect, it } from 'vitest';

import { buildRandomCustomCurvePlan } from '../fixtures/random-custom-curves';

const WAD = 10n ** 18n;
const MAX_MARKET_CAP_USD = 1_000_000_000;

describe('random custom curve plan', () => {
  it('generates cohesive curves with valid totals', () => {
    for (let i = 0; i < 100; i += 1) {
      const plan = buildRandomCustomCurvePlan(MAX_MARKET_CAP_USD);

      expect(plan.curves.length).toBeGreaterThan(2);
      expect(plan.curves.length).toBeLessThan(5);
      expect(plan.shareBps.length).toBe(plan.curves.length);
      expect(plan.shareBps.reduce((sum, bps) => sum + bps, 0)).toBe(10_000);

      const totalShares = plan.curves.reduce((sum, curve) => sum + BigInt(curve.sharesWad), 0n);
      expect(totalShares).toBe(WAD);

      for (let idx = 0; idx < plan.curves.length; idx += 1) {
        const curve = plan.curves[idx];
        expect(curve.marketCapStartUsd).toBeGreaterThan(1);
        expect(curve.marketCapStartUsd).toBeLessThan(1_000_000);
        expect(curve.marketCapEndUsd).toBeGreaterThan(curve.marketCapStartUsd);
        expect(curve.numPositions).toBeGreaterThan(0);
        expect(BigInt(curve.sharesWad)).toBeGreaterThan(0n);

        if (idx > 0) {
          expect(curve.marketCapStartUsd).toBe(plan.curves[idx - 1].marketCapEndUsd);
        }
      }

      expect(plan.curves[plan.curves.length - 1]?.marketCapEndUsd).toBe(MAX_MARKET_CAP_USD);
    }
  });
});
