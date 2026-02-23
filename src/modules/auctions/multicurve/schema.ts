import { z } from 'zod';

const wadString = z.string().regex(/^\d+$/, 'must be a positive integer string');
const addressString = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be a valid EVM address');

const standardInitializerSchema = z.object({
  type: z.literal('standard'),
});

const scheduledInitializerSchema = z.object({
  type: z.literal('scheduled'),
  startTime: z.number().int().positive(),
});

const decayInitializerSchema = z.object({
  type: z.literal('decay'),
  startFee: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive(),
  startTime: z.number().int().nonnegative().optional(),
});

const rehypeInitializerSchema = z.object({
  type: z.literal('rehype'),
  config: z.object({
    hookAddress: addressString,
    buybackDestination: addressString,
    customFee: z.number().int().nonnegative(),
    assetBuybackPercentWad: wadString,
    numeraireBuybackPercentWad: wadString,
    beneficiaryPercentWad: wadString,
    lpPercentWad: wadString,
    graduationCalldata: z
      .string()
      .regex(/^0x[0-9a-fA-F]*$/, 'must be hex bytes')
      .optional(),
    graduationMarketCap: z.number().positive().optional(),
    numerairePrice: z.number().positive().optional(),
    farTick: z.number().int().optional(),
  }),
});

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
  initializer: z
    .discriminatedUnion('type', [
      standardInitializerSchema,
      scheduledInitializerSchema,
      decayInitializerSchema,
      rehypeInitializerSchema,
    ])
    .optional(),
});

export type MulticurveAuctionInput = z.infer<typeof multicurveAuctionSchema>;
