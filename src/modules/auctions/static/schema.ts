import { z } from 'zod';

const WAD = 10n ** 18n;
const UINT16_MAX = 65_535;
const maxShareToBeSoldSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive integer string')
  .refine((value) => BigInt(value) <= WAD, `must be less than or equal to ${WAD.toString()}`);
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
    numPositions: z.number().int().positive().max(UINT16_MAX).optional(),
    maxShareToBeSoldWad: maxShareToBeSoldSchema.optional(),
  })
  .strict();

const staticRangeCurveConfigSchema = z
  .object({
    type: z.literal('range'),
    marketCapStartUsd: z.number().positive(),
    marketCapEndUsd: z.number().positive(),
    fee: staticFeeSchema.optional(),
    numPositions: z.number().int().positive().max(UINT16_MAX).optional(),
    maxShareToBeSoldWad: maxShareToBeSoldSchema.optional(),
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
