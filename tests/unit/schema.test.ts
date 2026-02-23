import { describe, expect, it } from 'vitest';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';

describe('create launch schema', () => {
  it('accepts valid payload with recipients alias', () => {
    const parsed = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      integrationAddress: '0x2222222222222222222222222222222222222222',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      tokenomics: {
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
    expect(parsed.tokenomics.allocations?.mode).toBe('vault');
    expect(parsed.tokenomics.allocations?.recipients?.length).toBe(2);
  });

  it('rejects payloads that mix recipients and allocations aliases', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x1111111111111111111111111111111111111111',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        tokenomics: {
          totalSupply: '100',
          allocations: {
            recipients: [{ address: '0x1111111111111111111111111111111111111111', amount: '10' }],
            allocations: [{ address: '0x2222222222222222222222222222222222222222', amount: '10' }],
          },
        },
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow(/cannot be used with tokenomics\.allocations\.allocations/i);
  });

  it('accepts multicurve initializer variants', () => {
    const base = {
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      tokenomics: { totalSupply: '100' },
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
      tokenomics: { totalSupply: '100' },
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
        tokenomics: { totalSupply: '100' },
        migration: { type: 'noOp' },
        auction: {
          type: 'static',
        },
      }),
    ).toThrow();
  });

  it('accepts governance=true and omitted governance', () => {
    const withBoolean = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      tokenomics: { totalSupply: '100' },
      governance: true,
      migration: { type: 'noOp' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });

    const withoutGovernance = createLaunchRequestSchema.parse({
      userAddress: '0x1111111111111111111111111111111111111111',
      tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
      tokenomics: { totalSupply: '100' },
      migration: { type: 'noOp' },
      auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
    });

    expect(withBoolean.governance).toBe(true);
    expect(withoutGovernance.governance).toBeUndefined();
  });

  it('rejects invalid address', () => {
    expect(() =>
      createLaunchRequestSchema.parse({
        userAddress: '0x123',
        tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
        tokenomics: { totalSupply: '100' },
        governance: { enabled: false, mode: 'noOp' },
        migration: { type: 'noOp' },
        auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
      }),
    ).toThrow();
  });
});
