// allow: SIZE_OK — allocation and pool-beneficiary policy share the canonical sale input boundary.
import { WAD, type BeneficiaryData } from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../../core/errors';
import type { CreateLaunchRequestInput } from '../../launches/schema';
import type { HexAddress } from '../../../core/types';

export const DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS = 90 * 24 * 60 * 60;
export const MIN_MARKET_SALE_PERCENT = 20n;
export const MAX_VESTING_ALLOCATIONS = 10;
export const MAX_FEE_BENEFICIARIES = 10;
const PROTOCOL_MIN_SHARE = WAD / 20n;

export interface AllocationPlan {
  allocationAmount: bigint;
  allocations: Array<{
    recipient: HexAddress;
    amount: bigint;
    durationSeconds: number;
    cliffDurationSeconds: number;
  }>;
}

export const parsePositiveBigInt = (value: string, field: string): bigint => {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch (error) {
    throw new AppError(422, 'INVALID_BIGINT', `${field} must be a valid bigint string`, error);
  }

  if (parsed <= 0n) {
    throw new AppError(422, 'INVALID_BIGINT', `${field} must be > 0`);
  }

  return parsed;
};

export const resolveSaleNumbers = (
  input: CreateLaunchRequestInput,
): { totalSupply: bigint; tokensForSale: bigint } => {
  const totalSupply = parsePositiveBigInt(input.economics.totalSupply, 'economics.totalSupply');
  const { entries: explicitAllocations, fieldPath: explicitAllocationsPath } =
    parseExplicitAllocations(input);
  const explicitAllocationTotal = explicitAllocations.reduce(
    (sum, entry) => sum + entry.amount,
    0n,
  );
  const hasExplicitAllocations = explicitAllocations.length > 0;
  const tokensForSale = input.economics.tokensForSale
    ? parsePositiveBigInt(input.economics.tokensForSale, 'economics.tokensForSale')
    : hasExplicitAllocations
      ? totalSupply - explicitAllocationTotal
      : totalSupply;

  if (tokensForSale <= 0n) {
    throw new AppError(422, 'INVALID_ECONOMICS', 'economics.tokensForSale must be > 0');
  }

  if (tokensForSale > totalSupply) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      'economics.tokensForSale cannot exceed economics.totalSupply',
    );
  }

  const maxBalanceLimit = input.tokenMetadata.maxBalanceLimit;
  if (
    maxBalanceLimit !== undefined &&
    /^\d+$/.test(maxBalanceLimit) &&
    BigInt(maxBalanceLimit) >= totalSupply
  ) {
    throw new AppError(
      422,
      'INVALID_TOKEN_CONFIG',
      'tokenMetadata.maxBalanceLimit must be less than economics.totalSupply',
    );
  }

  if (tokensForSale < totalSupply) {
    const marketPercentWad = tokensForSale * 100n;
    const minMarketPercentWad = totalSupply * MIN_MARKET_SALE_PERCENT;
    if (marketPercentWad < minMarketPercentWad) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        `economics.tokensForSale must be at least ${MIN_MARKET_SALE_PERCENT.toString()}% of totalSupply`,
      );
    }
  }

  if (hasExplicitAllocations) {
    const remainder = totalSupply - tokensForSale;
    if (explicitAllocationTotal !== remainder) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        `${explicitAllocationsPath} must sum exactly to totalSupply - tokensForSale`,
      );
    }
  }

  return { totalSupply, tokensForSale };
};

interface ExplicitAllocationEntry {
  recipient: HexAddress;
  amount: bigint;
  durationSeconds: number;
  cliffDurationSeconds: number;
}

interface ParsedExplicitAllocations {
  entries: ExplicitAllocationEntry[];
  fieldPath: 'economics.allocations';
}

const parseExplicitAllocations = (input: CreateLaunchRequestInput): ParsedExplicitAllocations => {
  const requested = input.economics.allocations ?? [];
  const fieldPath = 'economics.allocations';
  if (requested.length === 0) return { entries: [], fieldPath };

  if (requested.length > MAX_VESTING_ALLOCATIONS) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      `${fieldPath} supports up to ${MAX_VESTING_ALLOCATIONS} vesting schedules`,
    );
  }

  const entries = requested.map((entry, index: number) => {
    const cliffDurationSeconds = entry.cliffDurationSeconds ?? 0;
    if (cliffDurationSeconds > entry.durationSeconds) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        `${fieldPath}[${index}].cliffDurationSeconds cannot exceed durationSeconds`,
      );
    }

    return {
      recipient: entry.recipientAddress,
      amount: parsePositiveBigInt(entry.amount, `${fieldPath}[${index}].amount`),
      durationSeconds: entry.durationSeconds,
      cliffDurationSeconds,
    };
  });

  return { entries, fieldPath };
};

export const resolveAllocationPlan = (args: {
  input: CreateLaunchRequestInput;
  totalSupply: bigint;
  tokensForSale: bigint;
}): AllocationPlan => {
  const { input, totalSupply, tokensForSale } = args;
  const allocationAmount = totalSupply - tokensForSale;
  const config = input.economics.allocations;
  const { entries: explicitAllocations } = parseExplicitAllocations(input);

  if (allocationAmount === 0n) {
    if (config !== undefined) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        'economics.allocations requires tokensForSale to be less than totalSupply',
      );
    }

    return {
      allocationAmount,
      allocations: [],
    };
  }

  const allocations =
    explicitAllocations.length > 0
      ? explicitAllocations
      : [
          {
            recipient: input.userAddress,
            amount: allocationAmount,
            durationSeconds: DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS,
            cliffDurationSeconds: 0,
          },
        ];
  const totalExplicit = allocations.reduce((sum, allocation) => sum + allocation.amount, 0n);
  if (totalExplicit !== allocationAmount) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      'allocation amounts must equal totalSupply - tokensForSale',
    );
  }

  return {
    allocationAmount,
    allocations,
  };
};

const sumShares = (beneficiaries: BeneficiaryData[]): bigint =>
  beneficiaries.reduce((acc, b) => acc + b.shares, 0n);

export const normalizeFeeBeneficiaries = async (args: {
  input: CreateLaunchRequestInput;
  protocolOwner: HexAddress;
}): Promise<{ beneficiaries: BeneficiaryData[]; source: 'default' | 'request' }> => {
  const { input, protocolOwner } = args;

  if (!input.poolFeeBeneficiaries || input.poolFeeBeneficiaries.length === 0) {
    const userAddress = input.userAddress as HexAddress;
    if (input.userAddress.toLowerCase() === protocolOwner.toLowerCase()) {
      return {
        source: 'default',
        beneficiaries: [{ beneficiary: protocolOwner, shares: WAD }],
      };
    }

    return {
      source: 'default',
      beneficiaries: [
        { beneficiary: userAddress, shares: (WAD * 95n) / 100n },
        { beneficiary: protocolOwner, shares: (WAD * 5n) / 100n },
      ],
    };
  }

  if (input.poolFeeBeneficiaries.length > MAX_FEE_BENEFICIARIES) {
    throw new AppError(
      422,
      'INVALID_FEE_BENEFICIARIES',
      `poolFeeBeneficiaries supports up to ${MAX_FEE_BENEFICIARIES} unique addresses`,
    );
  }

  const seen = new Set<string>();
  const beneficiaries: BeneficiaryData[] = input.poolFeeBeneficiaries.map(
    (entry: { address: string; sharesWad: string }, index: number) => {
      const normalized = entry.address.toLowerCase();
      if (seen.has(normalized)) {
        throw new AppError(
          422,
          'INVALID_FEE_BENEFICIARIES',
          `poolFeeBeneficiaries has duplicate address at index ${index}`,
        );
      }
      seen.add(normalized);

      return {
        beneficiary: entry.address as HexAddress,
        shares: parsePositiveBigInt(
          entry.sharesWad,
          `poolFeeBeneficiaries[${entry.address}].sharesWad`,
        ),
      };
    },
  );

  const totalShares = sumShares(beneficiaries);

  const protocolBeneficiary = beneficiaries.find(
    (entry) => entry.beneficiary.toLowerCase() === protocolOwner.toLowerCase(),
  );

  if (!protocolBeneficiary) {
    const expectedWithoutProtocol = WAD - PROTOCOL_MIN_SHARE;
    if (totalShares !== expectedWithoutProtocol) {
      throw new AppError(
        422,
        'INVALID_FEE_BENEFICIARIES',
        `poolFeeBeneficiaries shares must sum to ${expectedWithoutProtocol.toString()} when protocol owner is omitted (API appends 5%)`,
      );
    }
    if (beneficiaries.length + 1 > MAX_FEE_BENEFICIARIES) {
      throw new AppError(
        422,
        'INVALID_FEE_BENEFICIARIES',
        `poolFeeBeneficiaries supports up to ${MAX_FEE_BENEFICIARIES} unique addresses including protocol owner`,
      );
    }

    return {
      beneficiaries: [
        ...beneficiaries,
        {
          beneficiary: protocolOwner,
          shares: PROTOCOL_MIN_SHARE,
        },
      ],
      source: 'request',
    };
  }

  if (totalShares !== WAD) {
    throw new AppError(
      422,
      'INVALID_FEE_BENEFICIARIES',
      `poolFeeBeneficiaries shares must sum to ${WAD.toString()}`,
    );
  }

  if (protocolBeneficiary.shares < PROTOCOL_MIN_SHARE) {
    throw new AppError(
      422,
      'INVALID_FEE_BENEFICIARIES',
      'protocol owner beneficiary shares must be at least 5% (WAD / 20)',
    );
  }

  return { beneficiaries, source: 'request' };
};
