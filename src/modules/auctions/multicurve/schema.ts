import { z } from 'zod';

const wadString = z.string().regex(/^\d+$/, 'must be a positive integer string');

export const presetCurveConfigSchema = z.object({
  type: z.literal('preset'),
  presets: z.array(z.enum(['low', 'medium', 'high'])).optional(),
  fee: z.number().int().positive().optional(),
  tickSpacing: z.number().int().positive().optional(),
});

export const rangesCurveConfigSchema = z.object({
  type: z.literal('ranges'),
  fee: z.number().int().positive().optional(),
  tickSpacing: z.number().int().positive().optional(),
  curves: z
    .array(
      z.object({
        marketCapStartUsd: z.number().positive(),
        marketCapEndUsd: z.union([z.number().positive(), z.literal('max')]),
        numPositions: z.number().int().positive(),
        sharesWad: wadString,
      }),
    )
    .min(1),
});

export const multicurveAuctionSchema = z.object({
  type: z.literal('multicurve'),
  curveConfig: z.discriminatedUnion('type', [presetCurveConfigSchema, rangesCurveConfigSchema]),
});

export type MulticurveAuctionInput = z.infer<typeof multicurveAuctionSchema>;
