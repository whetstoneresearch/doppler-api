import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from '../../src/modules/auctions/multicurve/mapper';
import type { CreateLaunchRequestInput } from '../../src/modules/launches/schema';

const baseInput: CreateLaunchRequestInput = {
  userAddress: '0x1111111111111111111111111111111111111111',
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://meta' },
  tokenomics: { totalSupply: '1000' },
  governance: { enabled: false, mode: 'noOp' },
  migration: { type: 'noOp' },
  auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
};

describe('sale number mapping', () => {
  it('defaults tokensForSale to totalSupply', () => {
    const sale = resolveSaleNumbers(baseInput);
    expect(sale.totalSupply).toBe(1000n);
    expect(sale.tokensForSale).toBe(1000n);
  });

  it('uses override when provided', () => {
    const sale = resolveSaleNumbers({
      ...baseInput,
      tokenomics: { totalSupply: '1000', tokensForSale: '700' },
    });
    expect(sale.tokensForSale).toBe(700n);
  });

  it('derives tokensForSale from recipients when tokensForSale is omitted', () => {
    const sale = resolveSaleNumbers({
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        allocations: {
          recipients: [
            { address: '0x2222222222222222222222222222222222222222', amount: '300' },
            { address: '0x3333333333333333333333333333333333333333', amount: '200' },
          ],
        },
      },
    });

    expect(sale.tokensForSale).toBe(500n);
  });

  it('defaults allocation lock to 90-day vest when remainder exists', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: { totalSupply: '1000', tokensForSale: '200' },
    };
    const sale = resolveSaleNumbers(input);
    const allocation = resolveAllocationPlan({
      input,
      totalSupply: sale.totalSupply,
      tokensForSale: sale.tokensForSale,
    });

    expect(allocation.allocationAmount).toBe(800n);
    expect(allocation.recipientAddress).toBe(baseInput.userAddress);
    expect(allocation.lockMode).toBe('vest');
    expect(allocation.lockDurationSeconds).toBe(DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS);
  });

  it('supports unlock mode for allocation', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '300',
        allocations: { mode: 'unlock', durationSeconds: 0 },
      },
    };
    const sale = resolveSaleNumbers(input);
    const allocation = resolveAllocationPlan({
      input,
      totalSupply: sale.totalSupply,
      tokensForSale: sale.tokensForSale,
    });

    expect(allocation.allocationAmount).toBe(700n);
    expect(allocation.lockMode).toBe('unlock');
    expect(allocation.lockDurationSeconds).toBe(0);
  });

  it('supports vault mode with custom recipient/duration/cliff', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '250',
        allocations: {
          recipientAddress: '0x2222222222222222222222222222222222222222',
          mode: 'vault',
          durationSeconds: 30 * 24 * 60 * 60,
          cliffDurationSeconds: 7 * 24 * 60 * 60,
        },
      },
    };
    const sale = resolveSaleNumbers(input);
    const allocation = resolveAllocationPlan({
      input,
      totalSupply: sale.totalSupply,
      tokensForSale: sale.tokensForSale,
    });

    expect(allocation.allocationAmount).toBe(750n);
    expect(allocation.recipientAddress).toBe('0x2222222222222222222222222222222222222222');
    expect(allocation.lockMode).toBe('vault');
    expect(allocation.lockDurationSeconds).toBe(30 * 24 * 60 * 60);
    expect(allocation.cliffDurationSeconds).toBe(7 * 24 * 60 * 60);
  });

  it('supports explicit multi-address allocations', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '400',
        allocations: {
          mode: 'vest',
          allocations: [
            { address: '0x2222222222222222222222222222222222222222', amount: '300' },
            { address: '0x3333333333333333333333333333333333333333', amount: '300' },
          ],
        },
      },
    };
    const sale = resolveSaleNumbers(input);
    const allocation = resolveAllocationPlan({
      input,
      totalSupply: sale.totalSupply,
      tokensForSale: sale.tokensForSale,
    });

    expect(allocation.allocationAmount).toBe(600n);
    expect(allocation.recipients).toEqual([
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ]);
    expect(allocation.amounts).toEqual([300n, 300n]);
    expect(allocation.recipientAddress).toBe('0x2222222222222222222222222222222222222222');
  });

  it('rejects allocation config when nothing is allocated', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '1000',
        allocations: { mode: 'vest' },
      },
    };
    const sale = resolveSaleNumbers(input);
    expect(() =>
      resolveAllocationPlan({
        input,
        totalSupply: sale.totalSupply,
        tokensForSale: sale.tokensForSale,
      }),
    ).toThrow(/tokenomics\.allocations requires tokensForSale to be less than totalSupply/i);
  });

  it('rejects unlock mode with non-zero duration', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '200',
        allocations: { mode: 'unlock', durationSeconds: 60 },
      },
    };
    const sale = resolveSaleNumbers(input);
    expect(() =>
      resolveAllocationPlan({
        input,
        totalSupply: sale.totalSupply,
        tokensForSale: sale.tokensForSale,
      }),
    ).toThrow(/durationSeconds must be 0 when mode is "unlock"/i);
  });

  it('rejects allocation sum mismatch against tokensForSale remainder', () => {
    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        tokenomics: {
          totalSupply: '1000',
          tokensForSale: '400',
          allocations: {
            allocations: [{ address: '0x2222222222222222222222222222222222222222', amount: '500' }],
          },
        },
      }),
    ).toThrow(/must sum exactly to totalSupply - tokensForSale/i);
  });

  it('rejects duplicate allocation addresses', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      tokenomics: {
        totalSupply: '1000',
        tokensForSale: '600',
        allocations: {
          allocations: [
            { address: '0x2222222222222222222222222222222222222222', amount: '200' },
            { address: '0x2222222222222222222222222222222222222222', amount: '200' },
          ],
        },
      },
    };
    expect(() =>
      resolveAllocationPlan({
        input,
        totalSupply: 1000n,
        tokensForSale: 600n,
      }),
    ).toThrow(/duplicate address/i);
  });

  it('rejects market sale below 20% of supply when allocations are split', () => {
    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        tokenomics: {
          totalSupply: '1000',
          tokensForSale: '199',
          allocations: {
            allocations: [{ address: '0x2222222222222222222222222222222222222222', amount: '801' }],
          },
        },
      }),
    ).toThrow(/at least 20% of totalSupply/i);
  });

  it('rejects allocation lists above 10 addresses', () => {
    const allocations = Array.from({ length: 11 }, (_, i) => ({
      address: `0x${(i + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
      amount: '10',
    }));

    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        tokenomics: {
          totalSupply: '1000',
          allocations: { allocations },
        },
      }),
    ).toThrow(/supports up to 10 unique addresses/i);
  });

  it('rejects mixing recipients and allocations aliases', () => {
    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        tokenomics: {
          totalSupply: '1000',
          allocations: {
            recipients: [{ address: '0x2222222222222222222222222222222222222222', amount: '300' }],
            allocations: [{ address: '0x3333333333333333333333333333333333333333', amount: '300' }],
          },
        },
      }),
    ).toThrow(/recipients cannot be used with tokenomics\.allocations\.allocations/i);
  });
});
