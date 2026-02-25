import { z } from 'zod';

import { dynamicAuctionSchema } from '../auctions/dynamic/schema';
import { multicurveAuctionSchema } from '../auctions/multicurve/schema';
import { staticAuctionSchema } from '../auctions/static/schema';

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be a valid EVM address');
const bigintStringSchema = z.string().regex(/^\d+$/, 'must be a positive integer string');
const auctionSchema = z.discriminatedUnion('type', [
  multicurveAuctionSchema,
  staticAuctionSchema,
  dynamicAuctionSchema,
]);
const allocationRecipientSchema = z.object({
  address: addressSchema,
  amount: bigintStringSchema,
});
const feeBeneficiarySchema = z.object({
  address: addressSchema,
  sharesWad: bigintStringSchema,
});
const allocationConfigSchema = z
  .object({
    recipientAddress: addressSchema.optional(),
    recipients: z.array(allocationRecipientSchema).max(10).optional(),
    mode: z.enum(['vest', 'unlock', 'vault']).optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    cliffDurationSeconds: z.number().int().nonnegative().optional(),
  })
  .strict();
const migrationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['noOp', 'uniswapV2', 'uniswapV3']),
  }),
  z.object({
    type: z.literal('uniswapV4'),
    fee: z.number().int().nonnegative(),
    tickSpacing: z.number().int().positive(),
  }),
]);

export const createLaunchRequestSchema = z.object({
  chainId: z.number().int().positive().optional(),
  userAddress: addressSchema,
  integrationAddress: addressSchema.optional(),
  tokenMetadata: z.object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    tokenURI: z.string().min(1),
  }),
  economics: z.object({
    totalSupply: bigintStringSchema,
    tokensForSale: bigintStringSchema.optional(),
    allocations: allocationConfigSchema.optional(),
  }),
  pairing: z
    .object({
      numeraireAddress: addressSchema.optional(),
    })
    .optional(),
  pricing: z
    .object({
      numerairePriceUsd: z.number().positive().optional(),
    })
    .optional(),
  feeBeneficiaries: z
    .array(feeBeneficiarySchema)
    .max(10)
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      value.forEach((entry, index) => {
        const normalized = entry.address.toLowerCase();
        if (seen.has(normalized)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'address'],
            message: `feeBeneficiaries has duplicate address at index ${index}`,
          });
          return;
        }
        seen.add(normalized);
      });
    })
    .optional(),
  governance: z
    .union([
      z.boolean(),
      z.object({
        enabled: z.boolean(),
        mode: z.enum(['noOp', 'default']).optional(),
      }),
    ])
    .optional(),
  migration: migrationSchema,
  auction: auctionSchema,
});

export const launchIdSchema = z
  .string()
  .regex(/^\d+:0x[a-fA-F0-9]{64}$/, 'launchId must be <chainId>:<txHash>');

export type CreateLaunchRequestInput = z.infer<typeof createLaunchRequestSchema>;
export type CreateMulticurveLaunchRequestInput = CreateLaunchRequestInput & {
  auction: z.infer<typeof multicurveAuctionSchema>;
};
export type CreateStaticLaunchRequestInput = CreateLaunchRequestInput & {
  auction: z.infer<typeof staticAuctionSchema>;
};
export type CreateDynamicLaunchRequestInput = CreateLaunchRequestInput & {
  auction: z.infer<typeof dynamicAuctionSchema>;
};
