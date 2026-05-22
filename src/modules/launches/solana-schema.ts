import { address } from '@solana/kit';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { SolanaNetwork } from '../../core/types';

const U64_MAX = 18_446_744_073_709_551_615n;
export const SOLANA_FEE_BPS_DENOMINATOR = 10_000;
export const SOLANA_MAX_FEE_BENEFICIARIES = 8;

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const positiveFiniteNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, 'must be a positive number');

const solanaAddressSchema = z.string().refine((value) => {
  try {
    address(value);
    return true;
  } catch {
    return false;
  }
}, 'must be a valid Solana address');

const u64StringSchema = z
  .string()
  .regex(/^\d+$/, 'must be a positive integer string')
  .refine((value) => {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= U64_MAX;
  }, 'must be a positive u64 integer string');

const u64NonNegativeStringSchema = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer string')
  .refine((value) => {
    const parsed = BigInt(value);
    return parsed <= U64_MAX;
  }, 'must be a non-negative u64 integer string');

const canonicalSolanaNetworkSchema = z.enum(['solanaDevnet', 'solanaMainnetBeta']);
const dedicatedSolanaNetworkSchema = z.enum(['devnet', 'mainnet-beta']);

const solanaTokenMetadataSchema = strictObject({
  name: z.string().min(1).max(32),
  symbol: z.string().min(1).max(10),
  tokenURI: z.string().min(1).max(200),
});

const solanaEconomicsSchema = strictObject({
  totalSupply: u64StringSchema,
  baseForDistribution: u64NonNegativeStringSchema.optional(),
  baseForLiquidity: u64NonNegativeStringSchema.optional(),
}).superRefine((value, ctx) => {
  const totalSupply = BigInt(value.totalSupply);
  const baseForDistribution = BigInt(value.baseForDistribution ?? '0');
  const baseForLiquidity = BigInt(value.baseForLiquidity ?? '0');

  if (baseForDistribution + baseForLiquidity >= totalSupply) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseForDistribution'],
      message: 'baseForDistribution + baseForLiquidity must be less than economics.totalSupply',
    });
  }

  if (baseForDistribution > 0n || baseForLiquidity > 0n) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseForDistribution'],
      message:
        'baseForDistribution and baseForLiquidity require a supported Solana migrator; omit them when migration.type is none',
    });
  }
});

const solanaPairingSchema = strictObject({
  numeraireAddress: solanaAddressSchema.optional(),
});

const solanaPricingSchema = strictObject({
  numerairePriceUsd: positiveFiniteNumberSchema.optional(),
});

const solanaFeeBeneficiarySchema = strictObject({
  address: solanaAddressSchema,
  shareBps: z.number().int().positive().max(SOLANA_FEE_BPS_DENOMINATOR),
});

const solanaFeeBeneficiariesSchema = z
  .array(solanaFeeBeneficiarySchema)
  .max(SOLANA_MAX_FEE_BENEFICIARIES)
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      return;
    }

    const seen = new Set<string>();
    let shareSum = 0;
    value.forEach((entry, index) => {
      if (seen.has(entry.address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'address'],
          message: `feeBeneficiaries has duplicate address at index ${index}`,
        });
      }
      seen.add(entry.address);
      shareSum += entry.shareBps;
    });

    if (shareSum !== SOLANA_FEE_BPS_DENOMINATOR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `feeBeneficiaries shareBps must sum to ${SOLANA_FEE_BPS_DENOMINATOR}`,
      });
    }
  });

const solanaMigrationSchema = strictObject({
  type: z.literal('none'),
});

const solanaAuctionSchema = strictObject({
  type: z.literal('xyk'),
  curveConfig: strictObject({
    type: z.literal('range'),
    marketCapStartUsd: positiveFiniteNumberSchema,
    marketCapEndUsd: positiveFiniteNumberSchema,
  }),
  curveFeeBps: z.number().int().min(0).max(10_000).optional(),
  swapFeeBps: z.number().int().min(0).max(10_000).optional(),
  allowBuy: z.boolean().optional(),
  allowSell: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (
    value.curveFeeBps !== undefined &&
    value.swapFeeBps !== undefined &&
    value.curveFeeBps !== value.swapFeeBps
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['swapFeeBps'],
      message: 'swapFeeBps and curveFeeBps must match when both are provided',
    });
  }
});

const baseSolanaCreateLaunchRequestShape = {
  tokenMetadata: solanaTokenMetadataSchema,
  economics: solanaEconomicsSchema,
  pairing: solanaPairingSchema.optional(),
  pricing: solanaPricingSchema.optional(),
  feeBeneficiaries: solanaFeeBeneficiariesSchema.optional(),
  governance: z.literal(false).optional(),
  migration: solanaMigrationSchema.optional(),
  auction: solanaAuctionSchema,
} satisfies z.ZodRawShape;

export const dedicatedSolanaCreateLaunchRequestSchema = strictObject({
  network: dedicatedSolanaNetworkSchema.optional(),
  ...baseSolanaCreateLaunchRequestShape,
});

export const genericSolanaCreateLaunchRequestSchema = strictObject({
  network: canonicalSolanaNetworkSchema,
  ...baseSolanaCreateLaunchRequestShape,
});

export type DedicatedSolanaCreateLaunchRequestInput = z.infer<
  typeof dedicatedSolanaCreateLaunchRequestSchema
>;
export type CreateSolanaLaunchRequestInput = z.infer<typeof genericSolanaCreateLaunchRequestSchema>;

const toCanonicalSolanaNetwork = (
  network: z.infer<typeof dedicatedSolanaNetworkSchema>,
): SolanaNetwork => {
  if (network === 'devnet') {
    return 'solanaDevnet';
  }

  return 'solanaMainnetBeta';
};

export const isSolanaCanonicalNetwork = (value: unknown): value is SolanaNetwork =>
  value === 'solanaDevnet' || value === 'solanaMainnetBeta';

export const normalizeDedicatedSolanaCreateRequest = (
  input: DedicatedSolanaCreateLaunchRequestInput,
  defaultNetwork: SolanaNetwork,
): CreateSolanaLaunchRequestInput =>
  genericSolanaCreateLaunchRequestSchema.parse({
    ...input,
    network: input.network ? toCanonicalSolanaNetwork(input.network) : defaultNetwork,
  });

const remapSolanaSchemaError = (error: z.ZodError): never => {
  const metadataIssue = error.issues.find((issue) => issue.path[0] === 'tokenMetadata');
  if (metadataIssue) {
    throw new AppError(422, 'SOLANA_INVALID_METADATA', 'Invalid Solana token metadata', {
      issues: error.issues,
    });
  }

  const curveIssue = error.issues.find(
    (issue) =>
      issue.path[0] === 'auction' &&
      (issue.path[1] === 'type' ||
        issue.path[1] === 'curveConfig' ||
        issue.path[1] === 'curveFeeBps' ||
        issue.path[1] === 'swapFeeBps'),
  );
  if (curveIssue) {
    throw new AppError(422, 'SOLANA_INVALID_CURVE', 'Invalid Solana XYK curve configuration', {
      issues: error.issues,
    });
  }

  const economicsIssue = error.issues.find(
    (issue) => issue.path[0] === 'economics' && issue.code !== z.ZodIssueCode.unrecognized_keys,
  );
  if (economicsIssue) {
    throw new AppError(422, 'SOLANA_INVALID_ECONOMICS', 'Invalid Solana economics', {
      issues: error.issues,
    });
  }

  const feeBeneficiaryIssue = error.issues.find((issue) => issue.path[0] === 'feeBeneficiaries');
  if (feeBeneficiaryIssue) {
    throw new AppError(
      422,
      'SOLANA_INVALID_FEE_BENEFICIARIES',
      'Invalid Solana fee beneficiaries',
      {
        issues: error.issues,
      },
    );
  }

  throw error;
};

export const parseDedicatedSolanaCreateLaunchRequest = (
  body: unknown,
  defaultNetwork: SolanaNetwork,
): CreateSolanaLaunchRequestInput => {
  try {
    const parsed = dedicatedSolanaCreateLaunchRequestSchema.parse(body);
    return normalizeDedicatedSolanaCreateRequest(parsed, defaultNetwork);
  } catch (error) {
    if (error instanceof z.ZodError) {
      remapSolanaSchemaError(error);
    }

    throw error;
  }
};

export const parseGenericSolanaCreateLaunchRequest = (
  body: unknown,
): CreateSolanaLaunchRequestInput => {
  try {
    return genericSolanaCreateLaunchRequestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      remapSolanaSchemaError(error);
    }

    throw error;
  }
};
