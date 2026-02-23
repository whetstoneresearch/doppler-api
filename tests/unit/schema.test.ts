import { describe, expect, it } from 'vitest';

import { createLaunchRequestSchema } from '../../src/modules/launches/schema';

describe('create launch schema', () => {
  it('accepts valid payload', () => {
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
          allocations: [
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
    expect(parsed.tokenomics.allocations?.allocations?.length).toBe(2);
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
