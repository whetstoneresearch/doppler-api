import { z } from 'zod';
import { V4_MAX_FEE } from '@whetstone-research/doppler-sdk/evm';

import type { HexAddress } from '../../../core/types';

const WAD = 10n ** 18n;
const UINT32_MAX = 4_294_967_295;
const INT24_MIN = -8_388_608;
const INT24_MAX = 8_388_607;
const wadString = z.string().regex(/^\d+$/, 'must be a non-negative integer string');
const addressString = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a valid EVM address')
  .refine((value: string) => !/^0x0{40}$/i.test(value), 'must be a non-zero EVM address')
  .transform((value: string): HexAddress => `0x${value.slice(2)}`);

const standardInitializerSchema = z.object({ type: z.literal('standard') }).strict();

const rehypeFeeBeneficiarySchema = z
  .object({
    address: addressString,
    sharesWad: wadString.refine(
      (value) => !/^\d+$/.test(value) || BigInt(value) > 0n,
      'must be a positive integer string',
    ),
  })
  .strict();

const rehypeFeeBeneficiariesSchema = z
  .array(rehypeFeeBeneficiarySchema)
  .nonempty()
  .max(10)
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    let totalShares = 0n;
    let hasInvalidShares = false;
    value.forEach((entry, index) => {
      const normalized = entry.address.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'address'],
          message: `rehypeFeeBeneficiaries has duplicate address at index ${index}`,
        });
      }
      seen.add(normalized);
      if (/^\d+$/.test(entry.sharesWad)) {
        totalShares += BigInt(entry.sharesWad);
      } else {
        hasInvalidShares = true;
      }
    });

    if (!hasInvalidShares && totalShares !== WAD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `rehypeFeeBeneficiaries shares must sum to ${WAD.toString()}`,
      });
    }
  });

export const rehypeFeeDistributionInfoSchema = z
  .object({
    assetFeesToAssetBuybackWad: wadString,
    assetFeesToNumeraireBuybackWad: wadString,
    assetFeesToBeneficiaryWad: wadString,
    assetFeesToLpWad: wadString,
    numeraireFeesToAssetBuybackWad: wadString,
    numeraireFeesToNumeraireBuybackWad: wadString,
    numeraireFeesToBeneficiaryWad: wadString,
    numeraireFeesToLpWad: wadString,
  })
  .strict()
  .superRefine((value, ctx) => {
    const distributionValues = Object.values(value);
    if (distributionValues.some((entry) => !/^\d+$/.test(entry))) {
      return;
    }
    const assetTotal =
      BigInt(value.assetFeesToAssetBuybackWad) +
      BigInt(value.assetFeesToNumeraireBuybackWad) +
      BigInt(value.assetFeesToBeneficiaryWad) +
      BigInt(value.assetFeesToLpWad);
    if (assetTotal !== WAD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetFeesToAssetBuybackWad'],
        message: `asset fee distribution must sum to ${WAD.toString()}`,
      });
    }

    const numeraireTotal =
      BigInt(value.numeraireFeesToAssetBuybackWad) +
      BigInt(value.numeraireFeesToNumeraireBuybackWad) +
      BigInt(value.numeraireFeesToBeneficiaryWad) +
      BigInt(value.numeraireFeesToLpWad);
    if (numeraireTotal !== WAD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numeraireFeesToAssetBuybackWad'],
        message: `numeraire fee distribution must sum to ${WAD.toString()}`,
      });
    }
  });

const rehypeConfigCommonSchema = z
  .object({
    startFee: z.number().int().min(0).max(800_000),
    endFee: z.number().int().min(0).max(800_000).optional(),
    durationSeconds: z.number().int().min(0).max(UINT32_MAX).optional(),
    startingTime: z.number().int().min(0).max(UINT32_MAX).optional(),
    feeDistributionInfo: rehypeFeeDistributionInfoSchema,
    graduationCalldata: z
      .string()
      .regex(/^0x[0-9a-fA-F]*$/, 'must be hex bytes')
      .optional(),
    graduationMarketCap: z.number().positive().optional(),
    numerairePrice: z.number().positive().optional(),
    farTick: z.number().int().min(INT24_MIN).max(INT24_MAX).safe().optional(),
  })
  .strict();

const rehypeConfigSchema = z
  .union([
    rehypeConfigCommonSchema.extend({
      buybackDestination: addressString,
    }),
    rehypeConfigCommonSchema.extend({
      rehypeFeeBeneficiaries: rehypeFeeBeneficiariesSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    const endFee = value.endFee ?? value.startFee;
    if (value.startFee < endFee) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endFee'],
        message: 'endFee cannot exceed startFee',
      });
    }
    if (value.startFee > endFee && (value.durationSeconds ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSeconds'],
        message: 'durationSeconds must be greater than 0 when startFee exceeds endFee',
      });
    }
    if (value.graduationMarketCap !== undefined && value.farTick !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['farTick'],
        message: 'farTick and graduationMarketCap are mutually exclusive',
      });
    }
  });

const rehypeInitializerSchema = z
  .object({
    type: z.literal('rehype'),
    config: rehypeConfigSchema,
  })
  .strict();

export const presetCurveConfigSchema = z
  .object({
    type: z.literal('preset'),
    presets: z.array(z.enum(['low', 'medium', 'high'])).optional(),
    fee: z.number().int().min(0).max(V4_MAX_FEE).optional(),
    tickSpacing: z.number().int().positive().optional(),
  })
  .strict();

export const rangesCurveConfigSchema = z
  .object({
    type: z.literal('ranges'),
    fee: z.number().int().min(0).max(V4_MAX_FEE).optional(),
    tickSpacing: z.number().int().positive().optional(),
    curves: z
      .array(
        z
          .object({
            marketCapStartUsd: z.number().positive(),
            marketCapEndUsd: z.union([z.number().positive(), z.literal('max')]),
            numPositions: z.number().int().positive(),
            sharesWad: wadString,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    let totalShares = 0n;
    value.curves.forEach((curve, index) => {
      if (/^\d+$/.test(curve.sharesWad)) {
        totalShares += BigInt(curve.sharesWad);
      }
      if (curve.marketCapEndUsd === 'max') {
        if (index !== value.curves.length - 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['curves', index, 'marketCapEndUsd'],
            message: '"max" is valid only for the final curve',
          });
        }
      } else if (curve.marketCapEndUsd <= curve.marketCapStartUsd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['curves', index, 'marketCapEndUsd'],
          message: 'marketCapEndUsd must exceed marketCapStartUsd',
        });
      }

      const next = value.curves[index + 1];
      if (
        next !== undefined &&
        curve.marketCapEndUsd !== 'max' &&
        next.marketCapStartUsd !== curve.marketCapEndUsd
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['curves', index + 1, 'marketCapStartUsd'],
          message: 'multicurve ranges must be contiguous',
        });
      }
    });

    if (value.curves.every((curve) => /^\d+$/.test(curve.sharesWad)) && totalShares !== WAD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['curves'],
        message: `curve shares must sum to ${WAD.toString()}`,
      });
    }
  });

export const multicurveAuctionSchema = z
  .object({
    type: z.literal('multicurve'),
    curveConfig: z.union([presetCurveConfigSchema, rangesCurveConfigSchema]),
    initializer: z
      .discriminatedUnion('type', [standardInitializerSchema, rehypeInitializerSchema])
      .optional(),
  })
  .strict();

export type MulticurveAuctionInput = z.infer<typeof multicurveAuctionSchema>;
