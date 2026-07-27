import { z } from 'zod';

const bigintStringSchema = z.string().regex(/^\d+$/, 'must be a positive integer string');
const staticFeeSchema = z.union([
  z.literal(100),
  z.literal(500),
  z.literal(3_000),
  z.literal(10_000),
]);

const staticPresetCurveConfigSchema = z
  .object({
    type: z.literal('preset'),
    preset: z.enum(['low', 'medium', 'high']),
    fee: staticFeeSchema.optional(),
    numPositions: z.number().int().positive().optional(),
    maxShareToBeSoldWad: bigintStringSchema.optional(),
  })
  .strict();

const staticRangeCurveConfigSchema = z
  .object({
    type: z.literal('range'),
    marketCapStartUsd: z.number().positive(),
    marketCapEndUsd: z.number().positive(),
    fee: staticFeeSchema.optional(),
    numPositions: z.number().int().positive().optional(),
    maxShareToBeSoldWad: bigintStringSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.marketCapEndUsd <= value.marketCapStartUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['marketCapEndUsd'],
        message: 'marketCapEndUsd must exceed marketCapStartUsd',
      });
    }
  });

export const staticAuctionSchema = z
  .object({
    type: z.literal('static'),
    curveConfig: z.union([staticPresetCurveConfigSchema, staticRangeCurveConfigSchema]),
  })
  .strict();

export type StaticAuctionInput = z.infer<typeof staticAuctionSchema>;
