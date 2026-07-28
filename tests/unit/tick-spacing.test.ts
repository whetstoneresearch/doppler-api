import { describe, expect, it } from 'vitest';

import {
  resolvePresetTickSpacing,
  resolveRangesTickSpacing,
} from '../../src/modules/auctions/multicurve/tick-spacing';

describe('tick spacing resolution', () => {
  it('leaves the omitted fee and all presets at the SDK low-tier default', () => {
    expect(resolvePresetTickSpacing({})).toBeUndefined();
  });

  it('derives preset tick spacing for low custom fee when omitted', () => {
    const spacing = resolvePresetTickSpacing({
      fee: 30000,
      presets: ['low'],
    });

    expect(spacing).toBe(200);
  });

  it('derives preset tick spacing for medium custom fee when omitted', () => {
    const spacing = resolvePresetTickSpacing({
      fee: 20000,
      presets: ['medium'],
    });

    expect(spacing).toBe(100);
  });

  it('keeps explicit preset tick spacing override', () => {
    const spacing = resolvePresetTickSpacing({
      fee: 30000,
      presets: ['low'],
      tickSpacing: 200,
    });

    expect(spacing).toBe(200);
  });

  it('aligns the high preset when using the standard fee tier', () => {
    const spacing = resolvePresetTickSpacing({
      fee: 10_000,
      presets: ['high'],
    });

    expect(spacing).toBe(100);
  });

  it('leaves an already-aligned standard fee tier to the SDK', () => {
    const spacing = resolvePresetTickSpacing({
      fee: 10_000,
      presets: ['low'],
    });

    expect(spacing).toBeUndefined();
  });

  it('derives range tick spacing from custom fee when omitted', () => {
    const spacing = resolveRangesTickSpacing({
      fee: 12000,
    });

    expect(spacing).toBe(240);
  });

  it('returns undefined for standard fee tiers and lets SDK default', () => {
    const spacing = resolveRangesTickSpacing({
      fee: 10000,
    });

    expect(spacing).toBeUndefined();
  });
});
