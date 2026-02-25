import { describe, expect, it } from 'vitest';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';

describe('create launch schema', () => {
  it('accepts valid payload with recipients alias', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      integrationAddress: '0x2222222222222222222222222222222222222222',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: {
        totalSupply: '100',
        tokensForSale: '50',
        allocations: {
          mode: 'vault',
          durationSeconds: 86400,
          cliffDurationSeconds: 3600,
          recipientAddress: '0x1111111111111111111111111111111111111111',
          recipients: [
            { address: '0x1111111111111111111111111111111111111111', amount: '25' },
            { address: '0x3333333333333333333333333333333333333333', amount: '25' },
          ],
        },
      },
      governance: { enabled: false, mode: 'noOp' },
      migration: { type: 'noOp' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });

    expect(parsed.integrationAddress).toBe('0x2222222222222222222222222222222222222222');
    expect(parsed.economics.allocations?.mode).toBe('vault');
    expect(parsed.economics.allocations?.recipients?.length).toBe(2);
  });

  it('rejects legacy allocations alias under economics.allocations', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: {
          totalSupply: '100',
          allocations: {
            allocations: [{ address: '0x2222222222222222222222222222222222222222', amount: '10' }],
          },
        },
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow(/unrecognized key/i);
  });

  it('accepts multicurve initializer variants', () => {
    const base = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'noOp' as const },
      auction: {
        type: 'multicurve' as const,
        curveConfig: { type: 'preset' as const, presets: ['low' as const] },
      },
    };

    const parseInitializerType = (
      initializer:
        | { type: 'standard' }
        | { type: 'scheduled'; startTime: number }
        | { type: 'decay'; startFee: number; durationSeconds: number; startTime?: number }
        | {
            type: 'rehype';
            config: {
              hookAddress: string;
              buybackDestination: string;
              customFee: number;
              assetBuybackPercentWad: string;
              numeraireBuybackPercentWad: string;
              beneficiaryPercentWad: string;
              lpPercentWad: string;
            };
          },
    ) => {
      const parsed = createLaunchRequestSchema.parse({
        ...base,
        auction: {
          ...base.auction,
          initializer,
        },
      });
      expect(parsed.auction.type).toBe('multicurve');
      return (parsed.auction as Extract<typeof parsed.auction, { type: 'multicurve' }>).initializer
        ?.type;
    };

    expect(parseInitializerType({ type: 'standard' })).toBe('standard');
    expect(parseInitializerType({ type: 'scheduled', startTime: 1_735_689_600 })).toBe('scheduled');
    expect(parseInitializerType({ type: 'decay', startFee: 400_000, durationSeconds: 60 })).toBe(
      'decay',
    );
    expect(
      parseInitializerType({
        type: 'rehype',
        config: {
          hookAddress: '0x2222222222222222222222222222222222222222',
          buybackDestination: '0x000000000000000000000000000000000000dEaD',
          customFee: 30_000,
          assetBuybackPercentWad: '500000000000000000',
          numeraireBuybackPercentWad: '500000000000000000',
          beneficiaryPercentWad: '0',
          lpPercentWad: '0',
        },
      }),
    ).toBe('rehype');
  });

  it('accepts static auction market cap presets', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Static Token', symbol: 'STK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'noOp' },
      auction: {
        type: 'static',
        curveConfig: {
          type: 'preset',
          preset: 'medium',
        },
      },
    });

    expect(parsed.auction.type).toBe('static');
    const staticAuction = parsed.auction as Extract<typeof parsed.auction, { type: 'static' }>;
    expect(staticAuction.curveConfig.type).toBe('preset');
    expect(
      (staticAuction.curveConfig as Extract<typeof staticAuction.curveConfig, { type: 'preset' }>)
        .preset,
    ).toBe('medium');
  });

  it('rejects static auction without curve config', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Static Token', symbol: 'STK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        migration: { type: 'noOp' },
        auction: {
          type: 'static',
        },
      }),
    ).toThrow();
  });

  it('accepts dynamic auction with explicit market-cap range and proceeds', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Dynamic Token', symbol: 'DYN', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'uniswapV2' },
      auction: {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapMinUsd: 50,
          minProceeds: '0.01',
          maxProceeds: '0.1',
          durationSeconds: 86_400,
        },
      },
    });

    expect(parsed.auction.type).toBe('dynamic');
    const dynamicAuction = parsed.auction as Extract<typeof parsed.auction, { type: 'dynamic' }>;
    expect(dynamicAuction.curveConfig.type).toBe('range');
    expect(dynamicAuction.curveConfig.marketCapStartUsd).toBe(100);
    expect(dynamicAuction.curveConfig.marketCapMinUsd).toBe(50);
  });

  it('rejects dynamic auction when minimum market cap is not below starting market cap', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Dynamic Token', symbol: 'DYN', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        migration: { type: 'uniswapV2' },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 100,
            minProceeds: '0.01',
            maxProceeds: '0.1',
          },
        },
      }),
    ).toThrow(/marketCapMinUsd must be less than marketCapStartUsd/i);
  });

  it('accepts migration.type=uniswapV3 at schema boundary for explicit 501 handling', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'uniswapV3' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });
    expect(parsed.migration.type).toBe('uniswapV3');
  });

  it('accepts migration.type=uniswapV4 with fee and tickSpacing', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'uniswapV4', fee: 10_000, tickSpacing: 100 },
      auction: {
        type: 'dynamic',
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapMinUsd: 50,
          minProceeds: '0.01',
          maxProceeds: '0.1',
        },
      },
    });
    expect(parsed.migration.type).toBe('uniswapV4');
  });

  it('rejects migration.type=uniswapV4 when fee/tickSpacing are missing', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        migration: { type: 'uniswapV4' },
        auction: {
          type: 'dynamic',
          curveConfig: {
            type: 'range',
            marketCapStartUsd: 100,
            marketCapMinUsd: 50,
            minProceeds: '0.01',
            maxProceeds: '0.1',
          },
        },
      }),
    ).toThrow();
  });

  it('accepts governance=true and omitted governance', () => {
    const withBoolean = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      governance: true,
      migration: { type: 'noOp' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });

    const withoutGovernance = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      economics: { totalSupply: '100' },
      migration: { type: 'noOp' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });

    expect(withBoolean.governance).toBe(true);
    expect(withoutGovernance.governance).toBeUndefined();
  });

  it('rejects governance.mode=custom at schema boundary', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        governance: { enabled: true, mode: 'custom' },
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow();
  });

  it('rejects invalid address', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x123',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow();
  });

  it('rejects duplicate fee beneficiary addresses', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        feeBeneficiaries: [
          { address: '0x2222222222222222222222222222222222222222', sharesWad: '1' },
          { address: '0x2222222222222222222222222222222222222222', sharesWad: '2' },
        ],
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow(/duplicate address/i);
  });

  it('rejects more than 10 fee beneficiaries', () => {
    const feeBeneficiaries = Array.from({ length: 11 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      sharesWad: '1',
    }));

    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        economics: { totalSupply: '100' },
        feeBeneficiaries,
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow();
  });
});
