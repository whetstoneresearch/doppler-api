import { describe, expect, it } from 'vitest';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';

const USER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const RECIPIENT_TWO = '0x3333333333333333333333333333333333333333';
const RECIPIENT_THREE = '0x4444444444444444444444444444444444444444';
const WAD = '1000000000000000000';

const baseRequest = {
  userAddress: USER,
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
  economics: { totalSupply: '1000' },
};

const dynamicAuction = {
  type: 'dynamic',
  curveConfig: {
    type: 'range',
    marketCapStartUsd: 100,
    marketCapMinUsd: 50,
    minProceeds: '1',
    maxProceeds: '2',
  },
};

const feeDistributionInfo = {
  assetFeesToAssetBuybackWad: WAD,
  assetFeesToNumeraireBuybackWad: '0',
  assetFeesToBeneficiaryWad: '0',
  assetFeesToLpWad: '0',
  numeraireFeesToAssetBuybackWad: WAD,
  numeraireFeesToNumeraireBuybackWad: '0',
  numeraireFeesToBeneficiaryWad: '0',
  numeraireFeesToLpWad: '0',
};

describe('canonical EVM boundary regressions', () => {
  it('accepts modern Rehype distribution input and rejects incomplete input', () => {
    const request = {
      ...baseRequest,
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
        initializer: {
          type: 'rehype',
          config: {
            buybackDestination: RECIPIENT,
            startFee: 30_000,
            endFee: 10_000,
            durationSeconds: 86_400,
            feeDistributionInfo,
          },
        },
      },
    };

    expect(createLaunchRequestSchema.safeParse(request).success).toBe(true);
    expect(
      createLaunchRequestSchema.safeParse({
        ...request,
        auction: {
          ...request.auction,
          initializer: {
            type: 'rehype',
            config: {
              buybackDestination: RECIPIENT,
              startFee: 30_000,
              endFee: 10_000,
              durationSeconds: 86_400,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts independent Rehype fee beneficiaries and rejects ambiguous or invalid splits', () => {
    const request = {
      ...baseRequest,
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
        initializer: {
          type: 'rehype',
          config: {
            rehypeFeeBeneficiaries: [
              { address: RECIPIENT, sharesWad: '200000000000000000' },
              { address: RECIPIENT_TWO, sharesWad: '300000000000000000' },
              { address: RECIPIENT_THREE, sharesWad: '500000000000000000' },
            ],
            startFee: 30_000,
            feeDistributionInfo,
          },
        },
      },
    };

    expect(createLaunchRequestSchema.safeParse(request).success).toBe(true);
    expect(
      createLaunchRequestSchema.safeParse({
        ...request,
        auction: {
          ...request.auction,
          initializer: {
            ...request.auction.initializer,
            config: {
              ...request.auction.initializer.config,
              buybackDestination: USER,
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      createLaunchRequestSchema.safeParse({
        ...request,
        auction: {
          ...request.auction,
          initializer: {
            ...request.auction.initializer,
            config: {
              ...request.auction.initializer.config,
              rehypeFeeBeneficiaries: [
                { address: RECIPIENT, sharesWad: '500000000000000000' },
                { address: RECIPIENT, sharesWad: '500000000000000000' },
              ],
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      createLaunchRequestSchema.safeParse({
        ...request,
        auction: {
          ...request.auction,
          initializer: {
            ...request.auction.initializer,
            config: {
              ...request.auction.initializer.config,
              rehypeFeeBeneficiaries: [
                { address: RECIPIENT, sharesWad: '200000000000000000' },
                { address: RECIPIENT_TWO, sharesWad: '300000000000000000' },
              ],
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects mutually exclusive and out-of-int24 Rehype graduation controls', () => {
    const rehypeRequest = {
      ...baseRequest,
      auction: {
        type: 'multicurve',
        curveConfig: { type: 'preset', presets: ['medium'] },
        initializer: {
          type: 'rehype',
          config: {
            buybackDestination: RECIPIENT,
            startFee: 30_000,
            feeDistributionInfo,
          },
        },
      },
    };

    expect(
      createLaunchRequestSchema.safeParse({
        ...rehypeRequest,
        auction: {
          ...rehypeRequest.auction,
          initializer: {
            ...rehypeRequest.auction.initializer,
            config: {
              ...rehypeRequest.auction.initializer.config,
              graduationMarketCap: 1_000_000,
              farTick: 100,
            },
          },
        },
      }).success,
    ).toBe(false);

    for (const farTick of [-8_388_609, 8_388_608]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...rehypeRequest,
          auction: {
            ...rehypeRequest.auction,
            initializer: {
              ...rehypeRequest.auction.initializer,
              config: {
                ...rehypeRequest.auction.initializer.config,
                farTick,
              },
            },
          },
        }).success,
      ).toBe(false);
    }
  });

  it('accepts multiple independent vesting schedules for the same recipient', () => {
    const result = createLaunchRequestSchema.safeParse({
      ...baseRequest,
      economics: {
        totalSupply: '1000',
        tokensForSale: '700',
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: '100',
            durationSeconds: 86_400,
            cliffDurationSeconds: 0,
          },
          {
            recipientAddress: RECIPIENT,
            amount: '200',
            durationSeconds: 172_800,
            cliffDurationSeconds: 86_400,
          },
        ],
      },
      auction: {
        type: 'static',
        curveConfig: { type: 'preset', preset: 'medium' },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects legacy allocation modes and invalid independent schedules', () => {
    const staticAuction = {
      type: 'static',
      curveConfig: { type: 'preset', preset: 'medium' },
    };

    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        economics: {
          totalSupply: '1000',
          tokensForSale: '800',
          allocations: { mode: 'unlock' },
        },
        auction: staticAuction,
      }).success,
    ).toBe(false);
    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        economics: {
          totalSupply: '1000',
          tokensForSale: '800',
          allocations: [
            {
              recipientAddress: RECIPIENT,
              amount: '200',
              durationSeconds: 86_400,
              cliffDurationSeconds: 86_401,
            },
          ],
        },
        auction: staticAuction,
      }).success,
    ).toBe(false);
  });

  it('rejects SDK-invalid static and uniswapV4 migration bounds at the boundary', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        auction: {
          type: 'static',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapEndUsd: 100,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        auction: {
          type: 'static',
          curveConfig: {
            type: 'preset',
            preset: 'medium',
            fee: 2_500,
          },
        },
      }).success,
    ).toBe(false);

    for (const migration of [
      {
        type: 'uniswapV4',
        fee: 150_001,
        tickSpacing: 1,
        lockDurationSeconds: 0,
      },
      {
        type: 'uniswapV4',
        fee: 150_000,
        tickSpacing: 1,
        lockDurationSeconds: 4_294_967_296,
      },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...baseRequest,
          migration,
          auction: dynamicAuction,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts zero-fee multicurve pools', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        auction: {
          type: 'multicurve',
          curveConfig: {
            type: 'preset',
            presets: ['medium'],
            fee: 0,
          },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects the retired public migrator and Rehype beneficiary names', () => {
    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        migration: {
          type: 'DopplerHookMigrator',
          fee: 3_000,
          tickSpacing: 60,
          lockDurationSeconds: 86_400,
        },
        auction: dynamicAuction,
      }).success,
    ).toBe(false);

    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        auction: {
          type: 'multicurve',
          curveConfig: { type: 'preset', presets: ['medium'] },
          initializer: {
            type: 'rehype',
            config: {
              feeBeneficiaries: [{ address: RECIPIENT, sharesWad: WAD }],
              startFee: 30_000,
              feeDistributionInfo,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects SDK-invalid dynamic fee, spacing, duration, and gamma combinations', () => {
    for (const curveConfig of [
      { ...dynamicAuction.curveConfig, fee: 100_001 },
      { ...dynamicAuction.curveConfig, fee: 2_500 },
      { ...dynamicAuction.curveConfig, tickSpacing: 31 },
      {
        ...dynamicAuction.curveConfig,
        durationSeconds: 100,
        epochLengthSeconds: 30,
      },
      {
        ...dynamicAuction.curveConfig,
        tickSpacing: 30,
        gamma: 31,
      },
    ]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...baseRequest,
          migration: {
            type: 'uniswapV2',
          },
          auction: {
            type: 'dynamic',
            curveConfig,
          },
        }).success,
      ).toBe(false);
    }

    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        migration: {
          type: 'uniswapV2',
        },
        auction: {
          type: 'dynamic',
          curveConfig: {
            ...dynamicAuction.curveConfig,
            fee: 2_500,
            tickSpacing: 10,
            durationSeconds: 120,
            epochLengthSeconds: 30,
            gamma: 20,
          },
        },
      }).success,
    ).toBe(true);
  });

  it('models the single V2 fee beneficiary with an integer 1-50% share', () => {
    for (const percentage of [1, 50]) {
      expect(
        createLaunchRequestSchema.safeParse({
          ...baseRequest,
          migration: {
            type: 'uniswapV2',
            feeBeneficiary: { address: RECIPIENT, percentage },
          },
          auction: dynamicAuction,
        }).success,
      ).toBe(true);
    }

    expect(
      createLaunchRequestSchema.safeParse({
        ...baseRequest,
        migration: {
          type: 'uniswapV2',
          feeBeneficiary: { address: RECIPIENT, percentage: 51 },
        },
        auction: dynamicAuction,
      }).success,
    ).toBe(false);
  });
});
