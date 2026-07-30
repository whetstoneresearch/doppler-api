import { z } from 'zod';
import {
  DEFAULT_AUCTION_DURATION,
  DEFAULT_EPOCH_LENGTH,
  DOPPLER_MAX_TICK_SPACING,
  VALID_FEE_TIERS,
  V4_MAX_FEE,
} from '@whetstone-research/doppler-sdk/evm';
import { parseUnits } from 'viem';
const PROCEEDS_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const UINT256_MAX = 2n ** 256n - 1n;
const isUint256Proceeds = (value: string): boolean => {
  const decimalIndex = value.indexOf('.');
  const wholeDigits = decimalIndex === -1 ? value.length : decimalIndex;
  return wholeDigits <= 60 && parseUnits(value, 18) <= UINT256_MAX;
};
const proceedsDecimalStringSchema = z
  .string()
  .regex(
    PROCEEDS_DECIMAL_PATTERN,
    'must be a canonical non-negative decimal string with up to 18 decimal places',
  )
  .refine(
    (value) => !PROCEEDS_DECIMAL_PATTERN.test(value) || isUint256Proceeds(value),
    `must encode to a uint256 no greater than ${UINT256_MAX.toString()}`,
  );
const standardFeeTiers = new Set<number>(VALID_FEE_TIERS);
const INT24_MAX = 8_388_607;
const MAX_PRICE_DISCOVERY_SLUGS = 15;

const dynamicRangeCurveConfigBaseSchema = z
  .object({
    type: z.literal('range'),
    marketCapStartUsd: z.number().positive(),
    marketCapMinUsd: z.number().positive(),
    minProceeds: proceedsDecimalStringSchema,
    maxProceeds: proceedsDecimalStringSchema,
    durationSeconds: z.number().int().positive().safe().optional(),
    epochLengthSeconds: z.number().int().positive().safe().optional(),
    fee: z.number().int().min(0).max(V4_MAX_FEE).safe().optional(),
    tickSpacing: z.number().int().positive().max(DOPPLER_MAX_TICK_SPACING).safe().optional(),
    gamma: z.number().int().positive().max(INT24_MAX).safe().optional(),
    numPdSlugs: z.number().int().positive().max(MAX_PRICE_DISCOVERY_SLUGS).safe().optional(),
  })
  .strict();

const dynamicRangeCurveConfigSchema = dynamicRangeCurveConfigBaseSchema.superRefine(
  (value: z.infer<typeof dynamicRangeCurveConfigBaseSchema>, ctx: z.RefinementCtx) => {
    if (value.marketCapMinUsd >= value.marketCapStartUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['marketCapMinUsd'],
        message: 'marketCapMinUsd must be less than marketCapStartUsd',
      });
    }

    if (
      PROCEEDS_DECIMAL_PATTERN.test(value.minProceeds) &&
      PROCEEDS_DECIMAL_PATTERN.test(value.maxProceeds) &&
      isUint256Proceeds(value.minProceeds) &&
      isUint256Proceeds(value.maxProceeds)
    ) {
      const minProceeds = parseUnits(value.minProceeds, 18);
      const maxProceeds = parseUnits(value.maxProceeds, 18);
      if (maxProceeds === 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxProceeds'],
          message: 'maxProceeds must be greater than zero',
        });
      } else if (minProceeds > maxProceeds) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxProceeds'],
          message: 'maxProceeds must be greater than or equal to minProceeds',
        });
      }
    }

    if (
      value.fee !== undefined &&
      !standardFeeTiers.has(value.fee) &&
      value.tickSpacing === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tickSpacing'],
        message: 'tickSpacing is required when fee is not a standard fee tier',
      });
    }

    const duration = value.durationSeconds ?? DEFAULT_AUCTION_DURATION;
    const epochLength = value.epochLengthSeconds ?? DEFAULT_EPOCH_LENGTH;
    if (duration % epochLength !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['epochLengthSeconds'],
        message: 'epochLengthSeconds must divide durationSeconds evenly',
      });
    }

    const tickSpacing = value.tickSpacing ?? DOPPLER_MAX_TICK_SPACING;
    if (value.gamma !== undefined && value.gamma % tickSpacing !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gamma'],
        message: 'gamma must be divisible by tickSpacing',
      });
    }
  },
);

export const dynamicAuctionSchema = z
  .object({
    type: z.literal('dynamic'),
    curveConfig: dynamicRangeCurveConfigSchema,
  })
  .strict();

export type DynamicAuctionInput = z.infer<typeof dynamicAuctionSchema>;
