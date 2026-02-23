import { z } from 'zod';

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, 'must be a positive decimal string');

const dynamicRangeCurveConfigSchema = z
  .object({
    type: z.literal('range'),
    marketCapStartUsd: z.number().positive(),
    marketCapMinUsd: z.number().positive(),
    minProceeds: decimalStringSchema,
    maxProceeds: decimalStringSchema,
    durationSeconds: z.number().int().positive().optional(),
    epochLengthSeconds: z.number().int().positive().optional(),
    fee: z.number().int().positive().optional(),
    tickSpacing: z.number().int().positive().optional(),
    gamma: z.number().int().positive().optional(),
    numPdSlugs: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.marketCapMinUsd >= value.marketCapStartUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['marketCapMinUsd'],
        message: 'marketCapMinUsd must be less than marketCapStartUsd',
      });
    }
  });

export const dynamicAuctionSchema = z.object({
  type: z.literal('dynamic'),
  curveConfig: dynamicRangeCurveConfigSchema,
});

export type DynamicAuctionInput = z.infer<typeof dynamicAuctionSchema>;
