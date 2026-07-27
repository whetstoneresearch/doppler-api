// allow: SIZE_OK — this file is the canonical EVM boundary rejection matrix.
import { describe, expect, it } from 'vitest';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import { genericSolanaCreateLaunchRequestSchema } from '../../src/modules/launches/solana-schema';
import { rangesCurveConfigSchema } from '../../src/modules/auctions/multicurve/schema';

const USER = '0x1111111111111111111111111111111111111111';
const BENEFICIARY = '0x2222222222222222222222222222222222222222';
const FEE_DISTRIBUTION_INFO = {
  assetFeesToAssetBuybackWad: '500000000000000000',
  assetFeesToNumeraireBuybackWad: '500000000000000000',
  assetFeesToBeneficiaryWad: '0',
  assetFeesToLpWad: '0',
  numeraireFeesToAssetBuybackWad: '500000000000000000',
  numeraireFeesToNumeraireBuybackWad: '500000000000000000',
  numeraireFeesToBeneficiaryWad: '0',
  numeraireFeesToLpWad: '0',
} as const;

const staticRequest = {
  userAddress: USER,
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
  economics: { totalSupply: '100' },
  auction: {
    type: 'static' as const,
    curveConfig: { type: 'preset' as const, preset: 'low' as const },
  },
};

const multicurveRequest = {
  ...staticRequest,
  auction: {
    type: 'multicurve' as const,
    curveConfig: { type: 'preset' as const, presets: ['low' as const] },
  },
};

const dynamicRequest = {
  ...staticRequest,
  migration: { type: 'uniswapV2' as const },
  auction: {
    type: 'dynamic' as const,
    curveConfig: {
      type: 'range' as const,
      marketCapStartUsd: 100,
      marketCapMinUsd: 50,
      minProceeds: '1',
      maxProceeds: '2',
    },
  },
};

describe('create launch schema characterizations', () => {
  it('preserves multicurve manual range end max', () => {
    const parsed = rangesCurveConfigSchema.parse({
      type: 'ranges',
      curves: [
        {
          marketCapStartUsd: 100,
          marketCapEndUsd: 'max',
          numPositions: 10,
          sharesWad: '1000000000000000000',
        },
      ],
    });

    expect(parsed.curves[0]?.marketCapEndUsd).toBe('max');
  });

  it('leaves the separate Solana feeBeneficiaries contract unchanged', () => {
    const parsed = genericSolanaCreateLaunchRequestSchema.parse({
      network: 'solanaDevnet',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '1000' },
      feeBeneficiaries: [{ address: '11111111111111111111111111111111', shareBps: 10_000 }],
      governance: false,
      migration: { type: 'none' },
      auction: {
        type: 'xyk',
        curveConfig: { type: 'range', marketCapStartUsd: 100, marketCapEndUsd: 1000 },
      },
    });

    expect(parsed.feeBeneficiaries).toEqual([
      { address: '11111111111111111111111111111111', shareBps: 10_000 },
    ]);
  });
});

describe('canonical EVM create launch schema', () => {
  it('accepts static and multicurve without a public migration', () => {
    expect(createLaunchRequestSchema.parse(staticRequest).auction.type).toBe('static');
    expect(createLaunchRequestSchema.parse(multicurveRequest).auction.type).toBe('multicurve');
  });

  it('rejects client-supplied no-op migration for static and multicurve', () => {
    expect(
      createLaunchRequestSchema.safeParse({ ...staticRequest, migration: { type: 'noOp' } })
        .success,
    ).toBe(false);
    expect(
      createLaunchRequestSchema.safeParse({ ...multicurveRequest, migration: { type: 'noOp' } })
        .success,
    ).toBe(false);
  });

  it('requires one canonical migration for dynamic', () => {
    const withoutMigration = {
      ...staticRequest,
      auction: dynamicRequest.auction,
    };
    expect(createLaunchRequestSchema.safeParse(withoutMigration).success).toBe(false);
    const parsed = createLaunchRequestSchema.parse(dynamicRequest);
    expect(parsed.auction.type).toBe('dynamic');
    expect('migration' in parsed).toBe(true);
    if ('migration' in parsed && parsed.migration !== undefined) {
      expect(parsed.migration.type).toBe('uniswapV2');
    }
  });

  it.each(['feeBeneficiaries', 'unknownRoot'])('rejects legacy or unknown root key %s', (key) => {
    expect(createLaunchRequestSchema.safeParse({ ...staticRequest, [key]: [] }).success).toBe(
      false,
    );
  });

  it('accepts unique poolFeeBeneficiaries and rejects duplicates case-insensitively', () => {
    const parsed = createLaunchRequestSchema.parse({
      ...staticRequest,
      poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '1000000000000000000' }],
    });
    expect(parsed.poolFeeBeneficiaries).toHaveLength(1);

    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        poolFeeBeneficiaries: [
          { address: BENEFICIARY.toLowerCase(), sharesWad: '1' },
          { address: BENEFICIARY.toUpperCase().replace('0X', '0x'), sharesWad: '2' },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts only boolean, address, or omitted governance', () => {
    expect(createLaunchRequestSchema.parse(staticRequest).governance).toBeUndefined();
    expect(
      createLaunchRequestSchema.parse({ ...staticRequest, governance: false }).governance,
    ).toBe(false);
    expect(createLaunchRequestSchema.parse({ ...staticRequest, governance: true }).governance).toBe(
      true,
    );
    expect(
      createLaunchRequestSchema.parse({ ...staticRequest, governance: BENEFICIARY }).governance,
    ).toBe(BENEFICIARY);
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        governance: { enabled: true, mode: 'default' },
      }).success,
    ).toBe(false);
  });

  it('accepts every DopplerERC20V1 control with its canonical type', () => {
    const parsed = createLaunchRequestSchema.parse({
      ...staticRequest,
      tokenMetadata: {
        ...staticRequest.tokenMetadata,
        maxBalanceLimit: '10',
        balanceLimitEnd: 4_000_000_000,
        controller: BENEFICIARY,
        excludedFromBalanceLimit: [USER, BENEFICIARY],
      },
    });

    expect(parsed.tokenMetadata).toMatchObject({
      maxBalanceLimit: '10',
      balanceLimitEnd: 4_000_000_000,
      controller: BENEFICIARY,
      excludedFromBalanceLimit: [USER, BENEFICIARY],
    });
  });

  it.each([
    { maxBalanceLimit: '-1' },
    { maxBalanceLimit: 1 },
    { balanceLimitEnd: -1 },
    { balanceLimitEnd: 1.5 },
    { controller: '0x123' },
    { type: 'standard' },
    { type: 'doppler404' },
  ])('rejects malformed or alternate token control %#', (invalidControl) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        tokenMetadata: { ...staticRequest.tokenMetadata, ...invalidControl },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate balance-limit exclusions case-insensitively', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        tokenMetadata: {
          ...staticRequest.tokenMetadata,
          excludedFromBalanceLimit: [
            BENEFICIARY.toLowerCase(),
            BENEFICIARY.toUpperCase().replace('0X', '0x'),
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts only standard and rehype multicurve initializers', () => {
    expect(
      createLaunchRequestSchema.parse({
        ...multicurveRequest,
        auction: { ...multicurveRequest.auction, initializer: { type: 'standard' } },
      }).auction.type,
    ).toBe('multicurve');
    expect(
      createLaunchRequestSchema.parse({
        ...multicurveRequest,
        auction: {
          ...multicurveRequest.auction,
          initializer: {
            type: 'rehype',
            config: {
              buybackDestination: BENEFICIARY,
              startFee: 30_000,
              endFee: 10_000,
              durationSeconds: 86_400,
              startingTime: 1_735_689_600,
              feeDistributionInfo: FEE_DISTRIBUTION_INFO,
            },
          },
        },
      }).auction.type,
    ).toBe('multicurve');

    for (const initializer of [
      { type: 'scheduled', startTime: 1 },
      { type: 'decay', startFee: 1, durationSeconds: 1 },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...multicurveRequest,
          auction: { ...multicurveRequest.auction, initializer },
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    { hookAddress: BENEFICIARY },
    { feeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '1' }] },
    { feeRoutingMode: 'routeToBeneficiaryFees' },
    { feeDistributionInfo: {} },
  ])('rejects Rehype hook or fee-routing field %#', (forbiddenField) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...multicurveRequest,
        auction: {
          ...multicurveRequest.auction,
          initializer: {
            type: 'rehype',
            config: {
              buybackDestination: BENEFICIARY,
              startFee: 30_000,
              feeDistributionInfo: FEE_DISTRIBUTION_INFO,
              ...forbiddenField,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    { type: 'noOp' },
    { type: 'uniswapV3' },
    { type: 'uniswapV4', fee: 10_000, tickSpacing: 100 },
    { type: 'dopplerHook', fee: 10_000, tickSpacing: 100, lockDurationSeconds: 1 },
  ])('rejects non-canonical dynamic migration %#', (migration) => {
    expect(createLaunchRequestSchema.safeParse({ ...dynamicRequest, migration }).success).toBe(
      false,
    );
  });

  it('accepts exact V2 fee beneficiary percentage boundaries', () => {
    for (const percentage of [1, 50]) {
      const parsed = createLaunchRequestSchema.parse({
        ...dynamicRequest,
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: BENEFICIARY, percentage },
        },
      });
      expect(parsed.auction.type).toBe('dynamic');
      expect('migration' in parsed).toBe(true);
      if ('migration' in parsed && parsed.migration !== undefined) {
        expect(parsed.migration.type).toBe('uniswapV2');
      }
    }
  });

  it.each([0, 51, 1.5])('rejects invalid V2 fee beneficiary percentage %s', (percentage) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: BENEFICIARY, percentage },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects top-level pool beneficiaries for V2 migration', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        poolFeeBeneficiaries: [{ address: BENEFICIARY, sharesWad: '1000000000000000000' }],
      }).success,
    ).toBe(false);
  });

  it('accepts fixed-fee uniswapV4 and rejects the unsupported dynamic LP fee flag', () => {
    const parsed = createLaunchRequestSchema.parse({
      ...dynamicRequest,
      migration: {
        type: 'uniswapV4',
        fee: 0,
        tickSpacing: 1,
        lockDurationSeconds: 0,
      },
    });
    expect(parsed.auction.type).toBe('dynamic');
    expect('migration' in parsed).toBe(true);
    if ('migration' in parsed) {
      expect(parsed.migration?.type).toBe('uniswapV4');
    }

    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        migration: {
          type: 'uniswapV4',
          fee: 0,
          tickSpacing: 1,
          lockDurationSeconds: 0,
          useDynamicFee: true,
        },
      }).success,
    ).toBe(false);
  });

  it('accepts exact RehypeDopplerHookMigrator fields and rejects SDK-only overrides', () => {
    const migration = {
      type: 'uniswapV4',
      fee: 3_000,
      tickSpacing: 60,
      lockDurationSeconds: 604_800,
      rehype: {
        buybackDestination: BENEFICIARY,
        customFee: 10_000,
        feeRoutingMode: 'directBuyback',
        feeDistributionInfo: FEE_DISTRIBUTION_INFO,
      },
    } as const;

    const parsed = createLaunchRequestSchema.parse({ ...dynamicRequest, migration });
    expect('migration' in parsed && parsed.migration).toEqual(migration);

    for (const invalidRehype of [
      { ...migration.rehype, hookAddress: BENEFICIARY },
      { ...migration.rehype, customFee: 1_000_001 },
      { ...migration.rehype, feeRoutingMode: 'unsupported' },
      {
        ...migration.rehype,
        feeDistributionInfo: {
          ...FEE_DISTRIBUTION_INFO,
          assetFeesToLpWad: '1',
        },
      },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...dynamicRequest,
          migration: { ...migration, rehype: invalidRehype },
        }).success,
      ).toBe(false);
    }
  });
});
