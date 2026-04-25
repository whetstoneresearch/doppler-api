import { WAD, type BeneficiaryData } from '@whetstone-research/doppler-sdk/evm';

import { AppError } from '../../../core/errors';
import type { CreateLaunchRequestInput } from '../../launches/schema';
import type { HexAddress } from '../../../core/types';

export const DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS = 90 * 24 * 60 * 60;
export const MIN_MARKET_SALE_PERCENT = 20n;
export const MAX_ALLOCATION_RECIPIENTS = 10;
export const MAX_FEE_BENEFICIARIES = 10;
const PROTOCOL_MIN_SHARE = WAD / 20n;

export interface AllocationPlan {
  allocationAmount: bigint;
  recipientAddress: HexAddress;
  recipients: HexAddress[];
  amounts: bigint[];
  lockMode: 'none' | 'vest' | 'unlock' | 'vault';
  lockDurationSeconds: number;
  cliffDurationSeconds: number;
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
  address: HexAddress;
  amount: bigint;
}

interface ParsedExplicitAllocations {
  entries: ExplicitAllocationEntry[];
  fieldPath: 'economics.allocations.recipients';
}

const parseExplicitAllocations = (input: CreateLaunchRequestInput): ParsedExplicitAllocations => {
  const config = input.economics.allocations;
  const recipients = config?.recipients ?? [];
  const fieldPath = 'economics.allocations.recipients';
  const requested = recipients;
  if (requested.length === 0) return { entries: [], fieldPath };

  if (requested.length > MAX_ALLOCATION_RECIPIENTS) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      `${fieldPath} supports up to ${MAX_ALLOCATION_RECIPIENTS} unique addresses`,
    );
  }

  const seen = new Set<string>();
  const entries = requested.map((entry, index) => {
    const normalized = entry.address.toLowerCase();
    if (seen.has(normalized)) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        `${fieldPath} has duplicate address at index ${index}`,
      );
    }
    seen.add(normalized);

    return {
      address: entry.address as HexAddress,
      amount: parsePositiveBigInt(entry.amount, `${fieldPath}[${index}].amount`),
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
    if (config) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        'economics.allocations requires tokensForSale to be less than totalSupply',
      );
    }

    return {
      allocationAmount,
      recipientAddress: input.userAddress as HexAddress,
      recipients: [],
      amounts: [],
      lockMode: 'none',
      lockDurationSeconds: 0,
      cliffDurationSeconds: 0,
    };
  }

  if (explicitAllocations.length > 0 && config?.recipientAddress) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      'economics.allocations.recipientAddress cannot be used with explicit recipient splits',
    );
  }

  const recipientAddress =
    explicitAllocations[0]?.address ??
    ((config?.recipientAddress ?? input.userAddress) as HexAddress);
  const requestedMode = config?.mode ?? 'vest';
  const cliffDurationSeconds = config?.cliffDurationSeconds ?? 0;

  let lockDurationSeconds: number;
  if (requestedMode === 'unlock') {
    if (config?.durationSeconds !== undefined && config.durationSeconds !== 0) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        'economics.allocations.durationSeconds must be 0 when mode is "unlock"',
      );
    }
    lockDurationSeconds = 0;
  } else {
    lockDurationSeconds = config?.durationSeconds ?? DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS;
    if (lockDurationSeconds <= 0) {
      throw new AppError(
        422,
        'INVALID_ECONOMICS',
        'economics.allocations.durationSeconds must be > 0 for vest/vault modes',
      );
    }
  }

  if (cliffDurationSeconds > lockDurationSeconds) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      'economics.allocations.cliffDurationSeconds cannot exceed durationSeconds',
    );
  }

  const recipients =
    explicitAllocations.length > 0
      ? explicitAllocations.map((entry) => entry.address)
      : [recipientAddress];
  const amounts =
    explicitAllocations.length > 0
      ? explicitAllocations.map((entry) => entry.amount)
      : [allocationAmount];
  const totalExplicit = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (totalExplicit !== allocationAmount) {
    throw new AppError(
      422,
      'INVALID_ECONOMICS',
      'allocation amounts must equal totalSupply - tokensForSale',
    );
  }

  return {
    allocationAmount,
    recipientAddress,
    recipients,
    amounts,
    lockMode: requestedMode,
    lockDurationSeconds,
    cliffDurationSeconds,
  };
};

const sumShares = (beneficiaries: BeneficiaryData[]): bigint =>
  beneficiaries.reduce((acc, b) => acc + b.shares, 0n);

export const normalizeFeeBeneficiaries = async (args: {
  input: CreateLaunchRequestInput;
  protocolOwner: HexAddress;
}): Promise<{ beneficiaries: BeneficiaryData[]; source: 'default' | 'request' }> => {
  const { input, protocolOwner } = args;

  if (!input.feeBeneficiaries || input.feeBeneficiaries.length === 0) {
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

  if (input.feeBeneficiaries.length > MAX_FEE_BENEFICIARIES) {
    throw new AppError(
      422,
      'INVALID_FEE_BENEFICIARIES',
      `feeBeneficiaries supports up to ${MAX_FEE_BENEFICIARIES} unique addresses`,
    );
  }

  const seen = new Set<string>();
  const beneficiaries: BeneficiaryData[] = input.feeBeneficiaries.map((entry, index) => {
    const normalized = entry.address.toLowerCase();
    if (seen.has(normalized)) {
      throw new AppError(
        422,
        'INVALID_FEE_BENEFICIARIES',
        `feeBeneficiaries has duplicate address at index ${index}`,
      );
    }
    seen.add(normalized);

    return {
      beneficiary: entry.address as HexAddress,
      shares: parsePositiveBigInt(entry.sharesWad, `feeBeneficiaries[${entry.address}].sharesWad`),
    };
  });

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
        `feeBeneficiaries shares must sum to ${expectedWithoutProtocol.toString()} when protocol owner is omitted (API appends 5%)`,
      );
    }
    if (beneficiaries.length + 1 > MAX_FEE_BENEFICIARIES) {
      throw new AppError(
        422,
        'INVALID_FEE_BENEFICIARIES',
        `feeBeneficiaries supports up to ${MAX_FEE_BENEFICIARIES} unique addresses including protocol owner`,
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
      `feeBeneficiaries shares must sum to ${WAD.toString()}`,
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
