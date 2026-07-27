import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS,
  resolveAllocationPlan,
  resolveSaleNumbers,
} from '../../src/modules/auctions/multicurve/mapper';
import type { CreateLaunchRequestInput } from '../../src/modules/launches/schema';

const USER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const baseInput: CreateLaunchRequestInput = {
  userAddress: USER,
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://meta' },
  economics: { totalSupply: '1000' },
  auction: { type: 'multicurve', curveConfig: { type: 'preset', presets: ['low'] } },
};

describe('sale number and vesting allocation mapping', () => {
  it('defaults the whole supply to the market when no allocation is configured', () => {
    const sale = resolveSaleNumbers(baseInput);
    const plan = resolveAllocationPlan({ input: baseInput, ...sale });

    expect(sale).toEqual({ totalSupply: 1000n, tokensForSale: 1000n });
    expect(plan).toEqual({ allocationAmount: 0n, allocations: [] });
  });

  it('defaults an unconfigured remainder to one 90-day schedule for the launch user', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      economics: { totalSupply: '1000', tokensForSale: '200' },
    };
    const sale = resolveSaleNumbers(input);

    expect(resolveAllocationPlan({ input, ...sale })).toEqual({
      allocationAmount: 800n,
      allocations: [
        {
          recipient: USER,
          amount: 800n,
          durationSeconds: DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS,
          cliffDurationSeconds: 0,
        },
      ],
    });
  });

  it('supports multiple independent schedules, including repeated recipients', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      economics: {
        totalSupply: '1000',
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: '250',
            durationSeconds: 30 * 24 * 60 * 60,
            cliffDurationSeconds: 7 * 24 * 60 * 60,
          },
          {
            recipientAddress: RECIPIENT,
            amount: '150',
            durationSeconds: 180 * 24 * 60 * 60,
          },
        ],
      },
    };
    const sale = resolveSaleNumbers(input);

    expect(sale.tokensForSale).toBe(600n);
    expect(resolveAllocationPlan({ input, ...sale })).toEqual({
      allocationAmount: 400n,
      allocations: [
        {
          recipient: RECIPIENT,
          amount: 250n,
          durationSeconds: 30 * 24 * 60 * 60,
          cliffDurationSeconds: 7 * 24 * 60 * 60,
        },
        {
          recipient: RECIPIENT,
          amount: 150n,
          durationSeconds: 180 * 24 * 60 * 60,
          cliffDurationSeconds: 0,
        },
      ],
    });
  });

  it('requires explicit schedules to exactly equal the non-market supply', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      economics: {
        totalSupply: '1000',
        tokensForSale: '600',
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: '399',
            durationSeconds: 86_400,
          },
        ],
      },
    };

    expect(() => resolveSaleNumbers(input)).toThrow(/sum exactly to totalSupply - tokensForSale/i);
  });

  it('rejects allocation schedules when the whole supply is sold', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      economics: {
        totalSupply: '1000',
        tokensForSale: '1000',
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: '1',
            durationSeconds: 86_400,
          },
        ],
      },
    };

    expect(() => resolveSaleNumbers(input)).toThrow(/sum exactly to totalSupply - tokensForSale/i);
  });

  it('rejects cliffs longer than their individual schedules', () => {
    const input: CreateLaunchRequestInput = {
      ...baseInput,
      economics: {
        totalSupply: '1000',
        allocations: [
          {
            recipientAddress: RECIPIENT,
            amount: '200',
            durationSeconds: 86_400,
            cliffDurationSeconds: 86_401,
          },
        ],
      },
    };

    expect(() => resolveSaleNumbers(input)).toThrow(/cliffDurationSeconds cannot exceed/i);
  });

  it('enforces the 20% market minimum and ten-schedule limit', () => {
    const schedules = Array.from({ length: 11 }, (_, index) => ({
      recipientAddress: RECIPIENT as `0x${string}`,
      amount: '10',
      durationSeconds: 86_400 + index,
    }));

    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        economics: {
          totalSupply: '1000',
          tokensForSale: '199',
          allocations: [
            {
              recipientAddress: RECIPIENT,
              amount: '801',
              durationSeconds: 86_400,
            },
          ],
        },
      }),
    ).toThrow(/at least 20% of totalSupply/i);

    expect(() =>
      resolveSaleNumbers({
        ...baseInput,
        economics: { totalSupply: '1000', allocations: schedules },
      }),
    ).toThrow(/up to 10 vesting schedules/i);
  });
});
