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
