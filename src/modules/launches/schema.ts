import { z } from 'zod';

import { dynamicAuctionSchema } from '../auctions/dynamic/schema';
import {
  multicurveAuctionSchema,
  rehypeFeeDistributionInfoSchema,
} from '../auctions/multicurve/schema';
import { staticAuctionSchema } from '../auctions/static/schema';
import type { HexAddress } from '../../core/types';

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a valid EVM address')
  .transform((value: string): HexAddress => `0x${value.slice(2)}`);
const nonZeroAddressSchema = addressSchema.refine(
  (value: HexAddress) => !/^0x0{40}$/i.test(value),
  'must be a non-zero EVM address',
);
const bigintStringSchema = z.string().regex(/^\d+$/, 'must be a non-negative integer string');
const positiveBigintStringSchema = bigintStringSchema.refine(
  (value: string) => /^\d+$/.test(value) && BigInt(value) > 0n,
  'must be a positive integer string',
);
const UINT32_MAX = 4_294_967_295;
const UINT48_MAX = 281_474_976_710_655;
const MIN_VESTING_DURATION_SECONDS = 86_400;

const vestingAllocationSchema = z
  .object({
    recipientAddress: nonZeroAddressSchema,
    amount: positiveBigintStringSchema,
    durationSeconds: z.number().int().min(MIN_VESTING_DURATION_SECONDS).max(UINT32_MAX).safe(),
    cliffDurationSeconds: z.number().int().min(0).max(UINT32_MAX).safe().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.cliffDurationSeconds ?? 0) > value.durationSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cliffDurationSeconds'],
        message: 'cliffDurationSeconds cannot exceed durationSeconds',
      });
    }
  })
  .array()
  .min(1)
  .max(10);

const poolFeeBeneficiarySchema = z
  .object({
    address: nonZeroAddressSchema,
    sharesWad: bigintStringSchema,
  })
  .strict();
type PoolFeeBeneficiary = z.infer<typeof poolFeeBeneficiarySchema>;

const poolFeeBeneficiariesSchema = z
  .array(poolFeeBeneficiarySchema)
  .max(10)
  .superRefine((value: PoolFeeBeneficiary[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    value.forEach((entry, index) => {
      const normalized = entry.address.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'address'],
          message: `poolFeeBeneficiaries has duplicate address at index ${index}`,
        });
      }
      seen.add(normalized);
    });
  });

const excludedFromBalanceLimitSchema = z
  .array(addressSchema)
  .superRefine((value: string[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    value.forEach((entry, index) => {
      const normalized = entry.toLowerCase();
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `excludedFromBalanceLimit has duplicate address at index ${index}`,
        });
      }
      seen.add(normalized);
    });
  });

const tokenMetadataSchema = z
  .object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    tokenURI: z.string().min(1),
    maxBalanceLimit: bigintStringSchema.optional(),
    balanceLimitEnd: z.number().int().nonnegative().max(UINT48_MAX).safe().optional(),
    controller: nonZeroAddressSchema.optional(),
    excludedFromBalanceLimit: excludedFromBalanceLimitSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { maxBalanceLimit, balanceLimitEnd } = value;
    const hasMaxBalanceLimit = maxBalanceLimit !== undefined;
    const hasBalanceLimitEnd = balanceLimitEnd !== undefined;
    if (hasMaxBalanceLimit !== hasBalanceLimitEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasMaxBalanceLimit ? ['balanceLimitEnd'] : ['maxBalanceLimit'],
        message: 'maxBalanceLimit and balanceLimitEnd must be provided together',
      });
      return;
    }

    if (maxBalanceLimit === undefined || balanceLimitEnd === undefined) {
      if ((value.excludedFromBalanceLimit?.length ?? 0) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['excludedFromBalanceLimit'],
          message: 'excludedFromBalanceLimit requires balance limiting to be enabled',
        });
      }
      return;
    }

    if (!/^\d+$/.test(maxBalanceLimit) || BigInt(maxBalanceLimit) === 0n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxBalanceLimit'],
        message: 'maxBalanceLimit must be greater than zero when balance limiting is enabled',
      });
    }
  });

const economicsSchema = z
  .object({
    totalSupply: bigintStringSchema,
    tokensForSale: bigintStringSchema.optional(),
    allocations: vestingAllocationSchema.optional(),
  })
  .strict();

const pairingSchema = z.object({ numeraireAddress: addressSchema.optional() }).strict();
const pricingSchema = z.object({ numerairePriceUsd: z.number().positive().optional() }).strict();
const governanceSchema = z.union([z.boolean(), nonZeroAddressSchema]);

const commonCreateShape = {
  chainId: z.number().int().positive().optional(),
  userAddress: nonZeroAddressSchema,
  integrationAddress: nonZeroAddressSchema.optional(),
  tokenMetadata: tokenMetadataSchema,
  economics: economicsSchema,
  pairing: pairingSchema.optional(),
  pricing: pricingSchema.optional(),
  poolFeeBeneficiaries: poolFeeBeneficiariesSchema.optional(),
  governance: governanceSchema.optional(),
};

const uniswapV2MigrationSchema = z
  .object({
    type: z.literal('uniswapV2'),
    feeBeneficiary: z
      .object({
        address: nonZeroAddressSchema,
        percentage: z.number().int().min(1).max(50),
      })
      .strict()
      .optional(),
  })
  .strict();

const uniswapV4MigrationSchema = z
  .object({
    type: z.literal('uniswapV4'),
    fee: z.number().int().min(0).max(150_000),
    tickSpacing: z.number().int().positive(),
    lockDurationSeconds: z.number().int().min(0).max(UINT32_MAX),
    rehype: z
      .object({
        buybackDestination: nonZeroAddressSchema,
        customFee: z.number().int().min(0).max(1_000_000),
        feeRoutingMode: z.enum(['directBuyback', 'routeToBeneficiaryFees']).optional(),
        feeDistributionInfo: rehypeFeeDistributionInfoSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const dynamicMigrationSchema = z.discriminatedUnion('type', [
  uniswapV2MigrationSchema,
  uniswapV4MigrationSchema,
]);

const staticCreateLaunchRequestSchema = z
  .object({
    ...commonCreateShape,
    auction: staticAuctionSchema,
  })
  .strict();

const multicurveCreateLaunchRequestSchema = z
  .object({
    ...commonCreateShape,
    auction: multicurveAuctionSchema,
  })
  .strict();

const dynamicCreateLaunchRequestBaseSchema = z
  .object({
    ...commonCreateShape,
    migration: dynamicMigrationSchema,
    auction: dynamicAuctionSchema,
  })
  .strict();

const dynamicCreateLaunchRequestSchema = dynamicCreateLaunchRequestBaseSchema.superRefine(
  (value: z.infer<typeof dynamicCreateLaunchRequestBaseSchema>, ctx: z.RefinementCtx) => {
    if (value.migration.type === 'uniswapV2' && value.poolFeeBeneficiaries !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['poolFeeBeneficiaries'],
        message: 'poolFeeBeneficiaries is not supported with migration.type="uniswapV2"',
      });
    }
  },
);

export const createLaunchRequestSchema = z.union([
  staticCreateLaunchRequestSchema,
  multicurveCreateLaunchRequestSchema,
  dynamicCreateLaunchRequestSchema,
]);

export const launchIdSchema = z
  .string()
  .regex(/^\d+:0x[a-fA-F0-9]{64}$/, 'launchId must be <chainId>:<txHash>');

export type CreateLaunchRequestInput = z.infer<typeof createLaunchRequestSchema>;
export type CreateMulticurveLaunchRequestInput = z.infer<
  typeof multicurveCreateLaunchRequestSchema
>;
export type CreateStaticLaunchRequestInput = z.infer<typeof staticCreateLaunchRequestSchema>;
export type CreateDynamicLaunchRequestInput = z.infer<typeof dynamicCreateLaunchRequestSchema>;
