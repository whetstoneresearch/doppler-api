import {
  DEFAULT_MULTICURVE_LOWER_TICKS,
  DEFAULT_MULTICURVE_UPPER_TICKS,
  TICK_SPACINGS,
} from '@whetstone-research/doppler-sdk';

const PRESET_INDEX: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
};

const gcdMany = (values: number[]): number => values.reduce((acc, value) => gcd(acc, value), 0);

const deriveTickSpacingFromFee = (fee: number): number => Math.max(1, Math.round((fee / 100) * 2));

export interface ResolvePresetTickSpacingArgs {
  fee?: number;
  tickSpacing?: number;
  presets?: Array<'low' | 'medium' | 'high'>;
}

export const resolvePresetTickSpacing = ({
  fee,
  tickSpacing,
  presets,
}: ResolvePresetTickSpacingArgs): number | undefined => {
  if (tickSpacing !== undefined) {
    return tickSpacing;
  }

  if (fee === undefined) {
    return undefined;
  }

  // Let the SDK handle built-in fee tiers.
  if ((TICK_SPACINGS as Record<number, number>)[fee] !== undefined) {
    return undefined;
  }

  const selectedPresets = presets?.length ? presets : (['low', 'medium', 'high'] as const);
  const presetTicks = selectedPresets.flatMap((preset) => {
    const idx = PRESET_INDEX[preset];
    return [DEFAULT_MULTICURVE_LOWER_TICKS[idx], DEFAULT_MULTICURVE_UPPER_TICKS[idx]];
  });

  const ticksGcd = gcdMany(presetTicks);
  if (ticksGcd <= 0) {
    return deriveTickSpacingFromFee(fee);
  }

  const candidate = Math.min(deriveTickSpacingFromFee(fee), ticksGcd);
  for (let spacing = candidate; spacing >= 1; spacing -= 1) {
    if (ticksGcd % spacing === 0) {
      return spacing;
    }
  }

  return 1;
};

export interface ResolveRangesTickSpacingArgs {
  fee?: number;
  tickSpacing?: number;
}

export const resolveRangesTickSpacing = ({
  fee,
  tickSpacing,
}: ResolveRangesTickSpacingArgs): number | undefined => {
  if (tickSpacing !== undefined) {
    return tickSpacing;
  }

  if (fee === undefined) {
    return undefined;
  }

  // Let the SDK handle built-in fee tiers.
  if ((TICK_SPACINGS as Record<number, number>)[fee] !== undefined) {
    return undefined;
  }

  return deriveTickSpacingFromFee(fee);
};
