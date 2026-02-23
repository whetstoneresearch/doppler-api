import { z } from 'zod';

const bigintStringSchema = z.string().regex(/^\d+$/, 'must be a positive integer string');

const staticPresetCurveConfigSchema = z.object({
  type: z.literal('preset'),
  preset: z.enum(['low', 'medium', 'high']),
  fee: z.number().int().positive().optional(),
  numPositions: z.number().int().positive().optional(),
  maxShareToBeSoldWad: bigintStringSchema.optional(),
});

const staticRangeCurveConfigSchema = z.object({
  type: z.literal('range'),
  marketCapStartUsd: z.number().positive(),
  marketCapEndUsd: z.number().positive(),
  fee: z.number().int().positive().optional(),
  numPositions: z.number().int().positive().optional(),
  maxShareToBeSoldWad: bigintStringSchema.optional(),
});

export const staticAuctionSchema = z.object({
  type: z.literal('static'),
  curveConfig: z.discriminatedUnion('type', [
    staticPresetCurveConfigSchema,
    staticRangeCurveConfigSchema,
  ]),
});

export type StaticAuctionInput = z.infer<typeof staticAuctionSchema>;
