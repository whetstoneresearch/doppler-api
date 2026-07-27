import { z } from 'zod';
import {
  DEFAULT_AUCTION_DURATION,
  DEFAULT_EPOCH_LENGTH,
  DOPPLER_MAX_TICK_SPACING,
  VALID_FEE_TIERS,
  V4_MAX_FEE,
} from '@whetstone-research/doppler-sdk/evm';

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, 'must be a positive decimal string');
const standardFeeTiers = new Set<number>(VALID_FEE_TIERS);

const dynamicRangeCurveConfigBaseSchema = z
  .object({
    type: z.literal('range'),
    marketCapStartUsd: z.number().positive(),
    marketCapMinUsd: z.number().positive(),
    minProceeds: decimalStringSchema,
    maxProceeds: decimalStringSchema,
    durationSeconds: z.number().int().positive().safe().optional(),
    epochLengthSeconds: z.number().int().positive().safe().optional(),
    fee: z.number().int().min(0).max(V4_MAX_FEE).safe().optional(),
    tickSpacing: z.number().int().positive().max(DOPPLER_MAX_TICK_SPACING).safe().optional(),
    gamma: z.number().int().positive().safe().optional(),
    numPdSlugs: z.number().int().positive().safe().optional(),
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
