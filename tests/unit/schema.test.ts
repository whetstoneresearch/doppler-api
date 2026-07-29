// allow: SIZE_OK — this file is the canonical EVM boundary rejection matrix.
import { describe, expect, it } from 'vitest';
import { formatUnits } from 'viem';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import { genericSolanaCreateLaunchRequestSchema } from '../../src/modules/launches/solana-schema';
import { rangesCurveConfigSchema } from '../../src/modules/auctions/multicurve/schema';

const USER = '0x1111111111111111111111111111111111111111';
const BENEFICIARY = '0x2222222222222222222222222222222222222222';
const SECOND_BENEFICIARY = '0x3333333333333333333333333333333333333333';
const WAD = '1000000000000000000';
const UINT32_MAX = 4_294_967_295;
const UINT256_MAX = (2n ** 256n - 1n).toString();
const UINT256_OVERFLOW = (2n ** 256n).toString();
const UINT256_MAX_PROCEEDS = formatUnits(2n ** 256n - 1n, 18);
const UINT256_PROCEEDS_OVERFLOW = formatUnits(2n ** 256n, 18);
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
const REHYPE_BUYBACK_INITIALIZER = {
  buybackDestination: BENEFICIARY,
  startFee: 30_000,
  endFee: 10_000,
  durationSeconds: 86_400,
  startingTime: 1_735_689_600,
  feeDistributionInfo: FEE_DISTRIBUTION_INFO,
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
    initializer: REHYPE_BUYBACK_INITIALIZER,
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
const uint256FieldCases = [
  {
    field: 'totalSupply',
    request: (value: string) => ({
      ...staticRequest,
      economics: { totalSupply: value },
    }),
  },
  {
    field: 'tokensForSale',
    request: (value: string) => ({
      ...staticRequest,
      economics: { totalSupply: UINT256_MAX, tokensForSale: value },
    }),
  },
  {
    field: 'allocations[].amount',
    request: (value: string) => ({
      ...staticRequest,
      economics: {
        totalSupply: UINT256_MAX,
        allocations: [{ recipientAddress: BENEFICIARY, amount: value, durationSeconds: 86_400 }],
      },
    }),
  },
  {
    field: 'maxBalanceLimit',
    request: (value: string) => ({
      ...staticRequest,
      tokenMetadata: {
        ...staticRequest.tokenMetadata,
        maxBalanceLimit: value,
        balanceLimitEnd: 1,
      },
      economics: { totalSupply: UINT256_MAX },
    }),
  },
] as const;

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

  it('accepts every DopplerERC20V1 control with balanceController', () => {
    const parsed = createLaunchRequestSchema.parse({
      ...staticRequest,
      tokenMetadata: {
        ...staticRequest.tokenMetadata,
        maxBalanceLimit: '10',
        balanceLimitEnd: 4_000_000_000,
        balanceController: BENEFICIARY,
        excludedFromBalanceLimit: [USER, BENEFICIARY],
      },
    });

    expect(parsed.tokenMetadata).toMatchObject({
      maxBalanceLimit: '10',
      balanceLimitEnd: 4_000_000_000,
      balanceController: BENEFICIARY,
      excludedFromBalanceLimit: [USER, BENEFICIARY],
    });
  });

  it('rejects the retired controller token metadata field', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        tokenMetadata: { ...staticRequest.tokenMetadata, controller: BENEFICIARY },
      }).success,
    ).toBe(false);
  });

  it.each([
    { maxBalanceLimit: '-1' },
    { maxBalanceLimit: 1 },
    { balanceLimitEnd: -1 },
    { balanceLimitEnd: 1.5 },
    { balanceController: '0x123' },
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

  it('requires the flattened Rehype multicurve initializer', () => {
    expect(createLaunchRequestSchema.parse(multicurveRequest).auction).toEqual(
      multicurveRequest.auction,
    );

    for (const initializer of [
      undefined,
      { type: 'standard' },
      { type: 'rehype', config: REHYPE_BUYBACK_INITIALIZER },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...multicurveRequest,
          auction:
            initializer === undefined
              ? {
                  type: 'multicurve',
                  curveConfig: multicurveRequest.auction.curveConfig,
                }
              : { ...multicurveRequest.auction, initializer },
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    ['graduationCalldata', '0x'],
    ['graduationMarketCap', 1_000_000],
    ['numerairePrice', 3_000],
    ['farTick', 100],
  ])('rejects removed multicurve initializer field %s', (field, value) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...multicurveRequest,
        auction: {
          ...multicurveRequest.auction,
          initializer: {
            ...REHYPE_BUYBACK_INITIALIZER,
            [field]: value,
          },
        },
      }).success,
    ).toBe(false);
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
            ...REHYPE_BUYBACK_INITIALIZER,
            ...forbiddenField,
          },
        },
      }).success,
    ).toBe(false);
  });

  it('validates independent Rehype beneficiaries', () => {
    const request = {
      ...multicurveRequest,
      auction: {
        ...multicurveRequest.auction,
        initializer: {
          rehypeFeeBeneficiaries: [
            { address: BENEFICIARY, sharesWad: '400000000000000000' },
            { address: SECOND_BENEFICIARY, sharesWad: '600000000000000000' },
          ],
          startFee: 30_000,
          feeDistributionInfo: FEE_DISTRIBUTION_INFO,
        },
      },
    };

    expect(createLaunchRequestSchema.safeParse(request).success).toBe(true);

    for (const initializer of [
      { ...request.auction.initializer, buybackDestination: USER },
      {
        ...request.auction.initializer,
        rehypeFeeBeneficiaries: [
          { address: BENEFICIARY, sharesWad: '500000000000000000' },
          { address: BENEFICIARY, sharesWad: '500000000000000000' },
        ],
      },
      {
        ...request.auction.initializer,
        rehypeFeeBeneficiaries: [
          { address: BENEFICIARY, sharesWad: '400000000000000000' },
          { address: SECOND_BENEFICIARY, sharesWad: '500000000000000000' },
        ],
      },
      { buybackDestination: BENEFICIARY, startFee: 30_000 },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...request,
          auction: { ...request.auction, initializer },
        }).success,
      ).toBe(false);
    }
  });

  it('accepts independent vesting schedules and rejects invalid allocation forms', () => {
    const allocations = [
      {
        recipientAddress: BENEFICIARY,
        amount: '10',
        durationSeconds: 86_400,
        cliffDurationSeconds: 0,
      },
      {
        recipientAddress: BENEFICIARY,
        amount: '20',
        durationSeconds: 172_800,
        cliffDurationSeconds: 86_400,
      },
    ];
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        economics: { totalSupply: '100', tokensForSale: '70', allocations },
      }).success,
    ).toBe(true);

    for (const invalidAllocations of [
      { mode: 'unlock' },
      [{ ...allocations[0], cliffDurationSeconds: 86_401 }],
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...staticRequest,
          economics: {
            totalSupply: '100',
            tokensForSale: '70',
            allocations: invalidAllocations,
          },
        }).success,
      ).toBe(false);
    }
  });

  it.each(uint256FieldCases)(
    'accepts uint256 max and rejects overflow for $field',
    ({ request }) => {
      expect(createLaunchRequestSchema.safeParse(request(UINT256_MAX)).success).toBe(true);
      expect(createLaunchRequestSchema.safeParse(request(UINT256_OVERFLOW)).success).toBe(false);
      expect(createLaunchRequestSchema.safeParse(request('01')).success).toBe(false);
    },
  );

  it('accepts exact static, dynamic, migration, and zero-fee multicurve boundaries', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        auction: {
          type: 'static',
          curveConfig: {
            type: 'preset',
            preset: 'medium',
            numPositions: 65_535,
            maxShareToBeSoldWad: WAD,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      createLaunchRequestSchema.safeParse({
        ...multicurveRequest,
        auction: {
          ...multicurveRequest.auction,
          curveConfig: {
            type: 'ranges',
            fee: 0,
            tickSpacing: 32_767,
            curves: [
              {
                marketCapStartUsd: 100,
                marketCapEndUsd: 'max',
                numPositions: 65_535,
                sharesWad: WAD,
              },
            ],
          },
          initializer: {
            ...REHYPE_BUYBACK_INITIALIZER,
            startFee: 0,
            endFee: 0,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        auction: {
          ...dynamicRequest.auction,
          curveConfig: {
            ...dynamicRequest.auction.curveConfig,
            tickSpacing: 1,
            gamma: 8_388_607,
            numPdSlugs: 15,
          },
        },
        migration: {
          type: 'uniswapV4',
          fee: 150_000,
          tickSpacing: 32_767,
          lockDurationSeconds: UINT32_MAX,
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    { type: 'preset', preset: 'medium', numPositions: 65_536 },
    { type: 'preset', preset: 'medium', maxShareToBeSoldWad: '1000000000000000001' },
    { type: 'preset', preset: 'medium', maxShareToBeSoldWad: '0' },
    { type: 'range', marketCapStartUsd: 100, marketCapEndUsd: 100 },
    { type: 'preset', preset: 'medium', fee: 2_500 },
  ])('rejects contract-invalid static curve %#', (curveConfig) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...staticRequest,
        auction: { type: 'static', curveConfig },
      }).success,
    ).toBe(false);
  });

  it.each([
    { type: 'preset', presets: ['medium'], tickSpacing: 32_768 },
    {
      type: 'ranges',
      tickSpacing: 32_768,
      curves: [{ marketCapStartUsd: 100, marketCapEndUsd: 'max', numPositions: 1, sharesWad: WAD }],
    },
    {
      type: 'ranges',
      curves: [
        {
          marketCapStartUsd: 100,
          marketCapEndUsd: 'max',
          numPositions: 65_536,
          sharesWad: WAD,
        },
      ],
    },
  ])('rejects contract-invalid multicurve config %#', (curveConfig) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...multicurveRequest,
        auction: { ...multicurveRequest.auction, curveConfig },
      }).success,
    ).toBe(false);
  });

  it('accepts the exact uint256 dynamic proceeds boundary', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        auction: {
          ...dynamicRequest.auction,
          curveConfig: {
            ...dynamicRequest.auction.curveConfig,
            minProceeds: '0',
            maxProceeds: UINT256_MAX_PROCEEDS,
          },
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['minProceeds', UINT256_PROCEEDS_OVERFLOW],
    ['maxProceeds', UINT256_PROCEEDS_OVERFLOW],
    ['minProceeds', '0.0000000000000000009'],
    ['maxProceeds', '1.0000000000000000009'],
    ['minProceeds', '01'],
    ['maxProceeds', '02'],
  ] as const)('rejects contract-invalid dynamic %s value %s', (field, value) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        auction: {
          ...dynamicRequest.auction,
          curveConfig: {
            ...dynamicRequest.auction.curveConfig,
            minProceeds: '0',
            maxProceeds: UINT256_MAX_PROCEEDS,
            [field]: value,
          },
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    { minProceeds: '0', maxProceeds: '0' },
    { minProceeds: '2', maxProceeds: '1' },
  ])('rejects invalid dynamic proceeds relation %#', (proceeds) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        auction: {
          ...dynamicRequest.auction,
          curveConfig: { ...dynamicRequest.auction.curveConfig, ...proceeds },
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    { ...dynamicRequest.auction.curveConfig, fee: 100_001 },
    { ...dynamicRequest.auction.curveConfig, fee: 2_500 },
    { ...dynamicRequest.auction.curveConfig, tickSpacing: 31 },
    {
      ...dynamicRequest.auction.curveConfig,
      durationSeconds: 100,
      epochLengthSeconds: 30,
    },
    { ...dynamicRequest.auction.curveConfig, tickSpacing: 30, gamma: 31 },
    { ...dynamicRequest.auction.curveConfig, tickSpacing: 1, gamma: 8_388_608 },
    { ...dynamicRequest.auction.curveConfig, numPdSlugs: 16 },
  ])('rejects contract-invalid dynamic curve %#', (curveConfig) => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...dynamicRequest,
        auction: { type: 'dynamic', curveConfig },
      }).success,
    ).toBe(false);
  });

  it.each([
    { type: 'uniswapV4', fee: 150_001, tickSpacing: 1, lockDurationSeconds: 0 },
    { type: 'uniswapV4', fee: 150_000, tickSpacing: 32_768, lockDurationSeconds: 0 },
    {
      type: 'uniswapV4',
      fee: 150_000,
      tickSpacing: 1,
      lockDurationSeconds: UINT32_MAX + 1,
    },
  ])('rejects contract-invalid migration %#', (migration) => {
    expect(createLaunchRequestSchema.safeParse({ ...dynamicRequest, migration }).success).toBe(
      false,
    );
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
