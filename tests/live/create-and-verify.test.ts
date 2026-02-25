import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  airlockAbi,
  computePoolId,
  decayMulticurveInitializerHookAbi,
  v4MulticurveInitializerAbi,
} from '@whetstone-research/doppler-sdk';
import {
  decodeAbiParameters,
  decodeFunctionData,
  formatEther,
  parseEther,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';

import { buildServices } from '../../src/app/server';
import { loadConfig } from '../../src/core/config';
import { decodeCreateEvent } from '../../src/infra/chain/receipt-decoder';
import type { CreateLaunchRequestInput } from '../../src/modules/launches/schema';
import { buildRandomCustomCurvePlan } from '../fixtures/random-custom-curves';
import { buildLiveBalanceRequirement, LIVE_READINESS_ERROR_MARKER } from './readiness-check';

const runLive = process.env.LIVE_TEST_ENABLE === 'true';
const liveVerbose = process.env.LIVE_TEST_VERBOSE === 'true';
const liveFilter = (process.env.LIVE_TEST_FILTER ?? 'all').toLowerCase();

type LiveScenarioGroup =
  | 'static'
  | 'dynamic'
  | 'multicurve'
  | 'multicurve-defaults'
  | 'negative'
  | 'governance';

const shouldRunScenario = (groups: LiveScenarioGroup[]): boolean => {
  if (!runLive) return false;

  if (liveFilter === 'all') return true;
  if (liveFilter === 'static') return groups.includes('static');
  if (liveFilter === 'dynamic') return groups.includes('dynamic');
  if (liveFilter === 'multicurve') {
    return groups.includes('multicurve') || groups.includes('multicurve-defaults');
  }
  if (liveFilter === 'multicurve-defaults') {
    return groups.includes('multicurve-defaults');
  }
  if (liveFilter === 'governance') return groups.includes('governance');
  if (liveFilter === 'negative') return groups.includes('negative');
  return true;
};

const liveIt = (
  title: string,
  groups: LiveScenarioGroup[],
  fn: () => Promise<void> | void,
  timeout?: number,
) => {
  const runner = shouldRunScenario(groups) ? it : it.skip;
  if (timeout === undefined) {
    (runner as any)(title, fn);
    return;
  }
  (runner as any)(title, fn, timeout);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getBaseScanUrl = (chainId: number): string | null => {
  if (chainId === 8453) return 'https://basescan.org';
  if (chainId === 84532) return 'https://sepolia.basescan.org';
  return null;
};

const feeConfigByPreset: Record<
  'low' | 'medium' | 'high',
  { fee: number; expectedTickSpacing: number; feePercent: string }
> = {
  low: { fee: 30000, expectedTickSpacing: 100, feePercent: '3.00%' },
  medium: { fee: 20000, expectedTickSpacing: 100, feePercent: '2.00%' },
  high: { fee: 10000, expectedTickSpacing: 200, feePercent: '1.00%' },
};

interface MulticurveLiveOverrides {
  governance?: boolean;
  feeConfigOverride?: { fee: number; expectedTickSpacing: number; feePercent: string };
  configLabel?: string;
  salePercent?: number;
  allocations?: {
    recipientAddress?: `0x${string}`;
    allocations?: Array<{ address: `0x${string}`; amount: string }>;
    recipients?: Array<{ address: `0x${string}`; amount: string }>;
    mode?: 'vest' | 'unlock' | 'vault';
    durationSeconds?: number;
    cliffDurationSeconds?: number;
  };
  initializer?:
    | {
        type: 'standard';
      }
    | {
        type: 'scheduled';
        startTime: number;
      }
    | {
        type: 'decay';
        startFee: number;
        durationSeconds: number;
        startTime?: number;
      }
    | {
        type: 'rehype';
        config: {
          hookAddress?: `0x${string}`;
          buybackDestination: `0x${string}`;
          customFee: number;
          assetBuybackPercentWad: string;
          numeraireBuybackPercentWad: string;
          beneficiaryPercentWad: string;
          lpPercentWad: string;
          graduationCalldata?: `0x${string}`;
          graduationMarketCap?: number;
          numerairePrice?: number;
          farTick?: number;
        };
      };
}

type LiveRowValue = string | number | boolean | null | undefined;
type LaunchSummaryRow = {
  config: string;
  status: 'created' | 'failed';
  tokenAddress?: string;
  pureUrl?: string;
  txHash?: string;
  reason?: string;
  salePercent?: string;
  allocationAmount?: string;
  allocationRecipients?: string;
  vestMode?: string;
  vestDuration?: string;
};

const launchSummaries: LaunchSummaryRow[] = [];

const liveDivider = (label: string): string => {
  const line = '='.repeat(88);
  return `\n${line}\n${label}\n${line}`;
};

const verboseLog = (...args: Parameters<typeof console.log>): void => {
  if (!liveVerbose) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

const toCell = (value: LiveRowValue): string => {
  if (value === null || value === undefined) return 'n/a';
  return String(value);
};

const printLiveTable = (title: string, rows: Array<[string, LiveRowValue]>): void => {
  const columns = ['Field', 'Value'];
  const tableRows = rows.map(([field, value]) => [field, toCell(value)]);
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...tableRows.map((row) => row[index].length)),
  );

  const pad = (value: string, width: number) => value.padEnd(width, ' ');
  const render = (row: string[]) =>
    row.map((value, index) => pad(value, widths[index])).join(' | ');
  const separator = widths.map((width) => '-'.repeat(width)).join('-+-');

  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  // eslint-disable-next-line no-console
  console.log(render(columns));
  // eslint-disable-next-line no-console
  console.log(separator);
  for (const row of tableRows) {
    // eslint-disable-next-line no-console
    console.log(render(row));
  }
};

const printLiveMatrix = (
  title: string,
  columns: string[],
  rows: Array<Array<LiveRowValue>>,
): void => {
  const normalizedRows = rows.map((row) => row.map((cell) => toCell(cell)));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...normalizedRows.map((row) => row[index]?.length ?? 0)),
  );

  const pad = (value: string, width: number) => value.padEnd(width, ' ');
  const render = (row: string[]) =>
    row.map((value, index) => pad(value, widths[index])).join(' | ');
  const separator = widths.map((width) => '-'.repeat(width)).join('-+-');

  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  // eslint-disable-next-line no-console
  console.log(render(columns));
  // eslint-disable-next-line no-console
  console.log(separator);
  for (const row of normalizedRows) {
    // eslint-disable-next-line no-console
    console.log(render(row));
  }
};

const getPureTokenUrl = (chainId: number, tokenAddress: string): string | null => {
  if (chainId === 84532) {
    return `https://dev.pure.st/tokens/base-sepolia/${tokenAddress}`;
  }
  if (chainId === 8453) {
    return `https://dev.pure.st/tokens/base/${tokenAddress}`;
  }
  return null;
};

const toShortError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n')[0] ?? message;
  const selector = message.match(/0x[0-9a-fA-F]{8}/)?.[0];
  return selector ? `${firstLine} (selector: ${selector})` : firstLine;
};

const randomFeePercentTwoDecimals = (): number => {
  // 0.01% to 10.00% in 0.01% increments
  const basisPoints = Math.floor(Math.random() * 1000) + 1;
  return basisPoints / 100;
};

const percentToFeeUnits = (percent: number): number => Math.round(percent * 10000);

const DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_LIVE_TOTAL_SUPPLY = 1_000_000n * 10n ** 18n;
const WAD = 10n ** 18n;
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

const calculateSaleAmount = (totalSupply: bigint, salePercent: number): bigint => {
  return (totalSupply * BigInt(salePercent)) / 100n;
};

const randomAddress = (): `0x${string}` => `0x${randomBytes(20).toString('hex')}`;

const buildRandomAddressAllocations = (
  totalAmount: bigint,
  recipientCount: number,
): Array<{ address: `0x${string}`; amount: string }> => {
  if (recipientCount < 3 || recipientCount > 5) {
    throw new Error(`recipientCount must be between 3 and 5 (received ${recipientCount})`);
  }
  if (totalAmount < BigInt(recipientCount)) {
    throw new Error('totalAmount is too small for requested recipientCount');
  }

  const addresses = new Set<string>();
  while (addresses.size < recipientCount) {
    addresses.add(randomAddress().toLowerCase());
  }
  const recipients = Array.from(addresses) as `0x${string}`[];

  const minimumPerRecipient = 1n;
  const base = Array.from({ length: recipientCount }, () => minimumPerRecipient);
  const remaining = totalAmount - BigInt(recipientCount) * minimumPerRecipient;
  const weights = Array.from(
    { length: recipientCount },
    () => BigInt(`0x${randomBytes(8).toString('hex')}`) + 1n,
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);

  const amounts = base.map((value, index) => value + (remaining * weights[index]!) / weightTotal);
  const distributed = amounts.reduce((sum, amount) => sum + amount, 0n);
  amounts[recipientCount - 1] = amounts[recipientCount - 1]! + (totalAmount - distributed);

  return recipients.map((address, index) => ({
    address,
    amount: amounts[index]!.toString(),
  }));
};

const decodeStandardTokenFactoryData = (
  tokenFactoryData: `0x${string}`,
): {
  yearlyMintRate: bigint;
  vestingDuration: bigint;
  recipients: readonly `0x${string}`[];
  amounts: readonly bigint[];
} => {
  const [, , yearlyMintRate, vestingDuration, recipients, amounts] = decodeAbiParameters(
    [
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'yearlyMintRate', type: 'uint256' },
      { name: 'vestingDuration', type: 'uint256' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'tokenURI', type: 'string' },
    ],
    tokenFactoryData,
  ) as readonly [
    string,
    string,
    bigint,
    bigint,
    readonly `0x${string}`[],
    readonly bigint[],
    string,
  ];

  return {
    yearlyMintRate,
    vestingDuration,
    recipients,
    amounts,
  };
};

type InitializerMode = 'standard' | 'scheduled' | 'decay' | 'rehype';

const curveTupleComponents = [
  { name: 'tickLower', type: 'int24' },
  { name: 'tickUpper', type: 'int24' },
  { name: 'numPositions', type: 'uint16' },
  { name: 'shares', type: 'uint256' },
] as const;

const beneficiaryTupleComponents = [
  { name: 'beneficiary', type: 'address' },
  { name: 'shares', type: 'uint96' },
] as const;

interface DecodedInitializerPoolConfig {
  fee: number;
  tickSpacing: number;
  curves: ReadonlyArray<{ shares: bigint }>;
  startingTime?: number;
  startFee?: number;
  durationSeconds?: number;
  dopplerHook?: `0x${string}`;
  onInitializationDopplerHookCalldata?: `0x${string}`;
}

interface DecodedDynamicPoolConfig {
  minimumProceeds: bigint;
  maximumProceeds: bigint;
  startingTime: bigint;
  endingTime: bigint;
  fee: number;
  tickSpacing: number;
}

const decodeDynamicPoolConfig = (poolInitializerData: `0x${string}`): DecodedDynamicPoolConfig => {
  const decoded = decodeAbiParameters(
    [
      { name: 'minimumProceeds', type: 'uint256' },
      { name: 'maximumProceeds', type: 'uint256' },
      { name: 'startingTime', type: 'uint256' },
      { name: 'endingTime', type: 'uint256' },
      { name: 'startingTick', type: 'int24' },
      { name: 'endingTick', type: 'int24' },
      { name: 'epochLength', type: 'uint256' },
      { name: 'gamma', type: 'int24' },
      { name: 'isToken0', type: 'bool' },
      { name: 'numPDSlugs', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
    ],
    poolInitializerData,
  );

  return {
    minimumProceeds: decoded[0],
    maximumProceeds: decoded[1],
    startingTime: decoded[2],
    endingTime: decoded[3],
    fee: Number(decoded[10]),
    tickSpacing: Number(decoded[11]),
  };
};

const decodeInitializerPoolConfig = (
  mode: InitializerMode,
  poolInitializerData: `0x${string}`,
): DecodedInitializerPoolConfig => {
  if (mode === 'decay') {
    const [decoded] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'startFee', type: 'uint24' },
            { name: 'fee', type: 'uint24' },
            { name: 'durationSeconds', type: 'uint32' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'curves', type: 'tuple[]', components: curveTupleComponents },
            {
              name: 'beneficiaries',
              type: 'tuple[]',
              components: beneficiaryTupleComponents,
            },
            { name: 'startingTime', type: 'uint32' },
          ],
        },
      ],
      poolInitializerData,
    ) as readonly [
      {
        startFee: number;
        fee: number;
        durationSeconds: number;
        tickSpacing: number;
        curves: ReadonlyArray<{ shares: bigint }>;
        startingTime: number;
      },
    ];

    return {
      startFee: decoded.startFee,
      fee: decoded.fee,
      durationSeconds: decoded.durationSeconds,
      tickSpacing: decoded.tickSpacing,
      curves: decoded.curves,
      startingTime: decoded.startingTime,
    };
  }

  if (mode === 'rehype') {
    const [decoded] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'farTick', type: 'int24' },
            { name: 'curves', type: 'tuple[]', components: curveTupleComponents },
            {
              name: 'beneficiaries',
              type: 'tuple[]',
              components: beneficiaryTupleComponents,
            },
            { name: 'dopplerHook', type: 'address' },
            { name: 'onInitializationDopplerHookCalldata', type: 'bytes' },
            { name: 'graduationDopplerHookCalldata', type: 'bytes' },
          ],
        },
      ],
      poolInitializerData,
    ) as readonly [
      {
        fee: number;
        tickSpacing: number;
        curves: ReadonlyArray<{ shares: bigint }>;
        dopplerHook: `0x${string}`;
        onInitializationDopplerHookCalldata: `0x${string}`;
      },
    ];

    return {
      fee: decoded.fee,
      tickSpacing: decoded.tickSpacing,
      curves: decoded.curves,
      dopplerHook: decoded.dopplerHook,
      onInitializationDopplerHookCalldata: decoded.onInitializationDopplerHookCalldata,
    };
  }

  const [decoded] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'curves', type: 'tuple[]', components: curveTupleComponents },
          {
            name: 'beneficiaries',
            type: 'tuple[]',
            components: beneficiaryTupleComponents,
          },
          { name: 'startingTime', type: 'uint32' },
        ],
      },
    ],
    poolInitializerData,
  ) as readonly [
    {
      fee: number;
      tickSpacing: number;
      curves: ReadonlyArray<{ shares: bigint }>;
      startingTime: number;
    },
  ];

  return {
    fee: decoded.fee,
    tickSpacing: decoded.tickSpacing,
    curves: decoded.curves,
    startingTime: decoded.startingTime,
  };
};

const resolveExpectedMulticurveInitializer = (args: {
  chainAddresses: Partial<{
    v4ScheduledMulticurveInitializer: `0x${string}`;
    v4DecayMulticurveInitializer: `0x${string}`;
    dopplerHookInitializer: `0x${string}`;
  }>;
  initializerType: InitializerMode;
}): `0x${string}` => {
  const { chainAddresses, initializerType } = args;

  const scheduledAddress = chainAddresses.v4ScheduledMulticurveInitializer as
    | `0x${string}`
    | undefined;
  const decayAddress = chainAddresses.v4DecayMulticurveInitializer as `0x${string}` | undefined;
  const rehypeAddress = chainAddresses.dopplerHookInitializer as `0x${string}` | undefined;

  if (initializerType === 'decay') {
    if (!decayAddress) {
      throw new Error('v4DecayMulticurveInitializer address missing for decay initializer');
    }
    return decayAddress;
  }

  if (initializerType === 'rehype') {
    if (!rehypeAddress) {
      throw new Error('dopplerHookInitializer address missing for rehype initializer');
    }
    return rehypeAddress;
  }

  if (!scheduledAddress) {
    throw new Error(
      'v4ScheduledMulticurveInitializer address missing for standard/scheduled modes',
    );
  }
  return scheduledAddress;
};

const readMulticurveStateWithRetry = async (args: {
  publicClient: { readContract: (...params: any[]) => Promise<unknown> };
  tokenAddress: `0x${string}`;
  poolInitializer: `0x${string}`;
  maxAttempts?: number;
  delayMs?: number;
}) => {
  const maxAttempts = args.maxAttempts ?? 20;
  const delayMs = args.delayMs ?? 1500;
  let lastReason = 'unknown';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    verboseLog(
      `[live] pool state lookup attempt ${attempt}/${maxAttempts} via initializer ${args.poolInitializer}`,
    );
    try {
      const stateData = (await args.publicClient.readContract({
        address: args.poolInitializer,
        abi: v4MulticurveInitializerAbi,
        functionName: 'getState',
        args: [args.tokenAddress],
      } as const)) as readonly [unknown, unknown, unknown, unknown];

      const [numeraireRaw, , poolKeyRaw] = stateData;
      const poolKeyStruct = poolKeyRaw as {
        currency0?: `0x${string}`;
        currency1?: `0x${string}`;
        fee?: number | bigint;
        tickSpacing?: number | bigint;
        hooks?: `0x${string}`;
      };
      const poolState = {
        currency0: (poolKeyStruct.currency0 ?? zeroAddress) as `0x${string}`,
        currency1: (poolKeyStruct.currency1 ?? zeroAddress) as `0x${string}`,
        numeraire: numeraireRaw as `0x${string}`,
        fee: Number(poolKeyStruct.fee ?? 0),
        tickSpacing: Number(poolKeyStruct.tickSpacing ?? 0),
        hooks: (poolKeyStruct.hooks ?? zeroAddress) as `0x${string}`,
      };

      if (poolState.hooks !== zeroAddress && poolState.tickSpacing !== 0) {
        return poolState;
      }

      lastReason = `state not initialized yet (hooks=${poolState.hooks}, tickSpacing=${poolState.tickSpacing})`;
    } catch (error) {
      lastReason = toShortError(error);
    }

    await sleep(delayMs);
  }

  throw new Error(
    `Pool state not available for token ${args.tokenAddress} via initializer ${args.poolInitializer} after ${maxAttempts} attempts. Last reason: ${lastReason}`,
  );
};

const waitForReceipt = async (
  publicClient: { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
  txHash: `0x${string}`,
): Promise<Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>> => {
  return publicClient.waitForTransactionReceipt({
    hash: txHash,
    pollingInterval: 1000,
    timeout: 120_000,
  } as const);
};

const waitForTransactionByHash = async (args: {
  publicClient: { getTransaction: (...params: any[]) => Promise<unknown> };
  txHash: `0x${string}`;
  maxAttempts?: number;
  delayMs?: number;
}) => {
  const maxAttempts = args.maxAttempts ?? 12;
  const delayMs = args.delayMs ?? 1500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await args.publicClient.getTransaction({ hash: args.txHash });
    } catch (error) {
      lastError = error;
      verboseLog(
        `[live] tx lookup attempt ${attempt}/${maxAttempts} failed for ${args.txHash}: ${toShortError(error)}`,
      );
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `Transaction lookup did not stabilize for ${args.txHash} after ${maxAttempts} attempts: ${toShortError(lastError)}`,
  );
};

const assertNotImplementedError = async (
  task: Promise<unknown>,
  expectedCode: 'MIGRATION_NOT_IMPLEMENTED',
): Promise<void> => {
  try {
    await task;
    throw new Error(`Expected rejection with code ${expectedCode}, but task resolved`);
  } catch (error) {
    const maybe = error as { statusCode?: number; code?: string; message?: string };
    expect(maybe.statusCode).toBe(501);
    expect(maybe.code).toBe(expectedCode);
    expect((maybe.message || '').toLowerCase()).toContain('not implemented');
  }
};

const runMulticurveLaunchAndVerify = async (
  preset: 'low' | 'medium' | 'high',
  overrides?: MulticurveLiveOverrides,
) => {
  const config = loadConfig();
  const services = buildServices(config);
  const chain = services.chainRegistry.get(config.defaultChainId);
  const userAddress = privateKeyToAccount(config.privateKey).address;
  const runId = Date.now().toString();
  const symbol = `${preset[0].toUpperCase()}${runId.slice(-4)}`;
  const tokenName = `Live ${preset.toUpperCase()} ${runId.slice(-6)}`;
  const tokenUri = `ipfs://live-test-token/${runId}`;
  const totalSupply = DEFAULT_LIVE_TOTAL_SUPPLY;
  const salePercent = Math.trunc(overrides?.salePercent ?? 100);
  if (salePercent <= 0 || salePercent > 100) {
    throw new Error(`salePercent must be in the range 1-100 (received ${salePercent})`);
  }
  const tokensForSale = calculateSaleAmount(totalSupply, salePercent);
  if (tokensForSale <= 0n) {
    throw new Error(`tokensForSale resolved to 0 for salePercent=${salePercent}`);
  }
  const allocationAmount = totalSupply - tokensForSale;
  const explicitAllocations =
    overrides?.allocations?.recipients ?? overrides?.allocations?.allocations ?? [];
  const explicitAllocationTotal = explicitAllocations.reduce(
    (sum, entry) => sum + BigInt(entry.amount),
    0n,
  );
  if (explicitAllocations.length > 0 && explicitAllocationTotal !== allocationAmount) {
    throw new Error(
      `explicit allocation sum mismatch: expected ${allocationAmount}, got ${explicitAllocationTotal}`,
    );
  }
  const requestedAllocationMode =
    allocationAmount > 0n ? (overrides?.allocations?.mode ?? 'vest') : 'none';
  const allocationRecipientAddress =
    explicitAllocations[0]?.address ?? overrides?.allocations?.recipientAddress ?? userAddress;
  const expectedVestingRecipients =
    explicitAllocations.length > 0
      ? explicitAllocations.map((allocation) => allocation.address)
      : allocationAmount > 0n
        ? [allocationRecipientAddress]
        : [];
  const expectedVestingAmounts =
    explicitAllocations.length > 0
      ? explicitAllocations.map((allocation) => BigInt(allocation.amount))
      : allocationAmount > 0n
        ? [allocationAmount]
        : [];
  const allocationLockDurationSeconds =
    requestedAllocationMode === 'none' || requestedAllocationMode === 'unlock'
      ? 0
      : (overrides?.allocations?.durationSeconds ?? DEFAULT_ALLOCATION_LOCK_DURATION_SECONDS);
  const salePercentIsDefault = overrides?.salePercent === undefined;
  const allocationRecipientIsDefault =
    explicitAllocations.length === 0 && !overrides?.allocations?.recipientAddress;
  const allocationModeIsDefault = allocationAmount > 0n && !overrides?.allocations?.mode;
  const allocationDurationIsDefault =
    allocationAmount > 0n &&
    requestedAllocationMode === 'vest' &&
    !overrides?.allocations?.durationSeconds;
  const salePercentDisplay = salePercentIsDefault ? `${salePercent}% (default)` : `${salePercent}%`;
  const allocationRecipientDisplay = allocationRecipientIsDefault
    ? `${allocationRecipientAddress} (default)`
    : allocationRecipientAddress;
  const allocationModeDisplay =
    requestedAllocationMode === 'none'
      ? 'none (default)'
      : allocationModeIsDefault
        ? `${requestedAllocationMode} (default)`
        : requestedAllocationMode;
  const allocationDurationDisplay =
    requestedAllocationMode === 'none'
      ? '0 (default)'
      : requestedAllocationMode === 'unlock'
        ? '0 (unlock)'
        : allocationDurationIsDefault
          ? `${allocationLockDurationSeconds} (default)`
          : String(allocationLockDurationSeconds);
  const requestedInitializer =
    overrides?.initializer?.type === 'rehype'
      ? {
          type: 'rehype' as const,
          config: {
            ...overrides.initializer.config,
            hookAddress:
              overrides.initializer.config.hookAddress ??
              (chain.addresses.rehypeDopplerHook as `0x${string}` | undefined),
          },
        }
      : (overrides?.initializer ?? ({ type: 'standard' } as const));
  if (requestedInitializer.type === 'rehype' && !requestedInitializer.config.hookAddress) {
    throw new Error(
      'Rehype initializer requires a hookAddress; chain has no default rehypeDopplerHook address',
    );
  }
  const initializerForPayload =
    requestedInitializer.type === 'rehype'
      ? {
          type: 'rehype' as const,
          config: {
            ...requestedInitializer.config,
            hookAddress: requestedInitializer.config.hookAddress!,
          },
        }
      : requestedInitializer;
  const explorerBase = getBaseScanUrl(chain.chainId);
  const numerairePriceUsd = Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000');
  const feeConfig = overrides?.feeConfigOverride ?? feeConfigByPreset[preset];
  const configLabel = overrides?.configLabel ?? `${preset.toUpperCase()} Default Configuration`;
  const summary: LaunchSummaryRow = {
    config: configLabel,
    status: 'failed',
    salePercent: salePercentDisplay,
    allocationAmount: allocationAmount === 0n ? '0 (default)' : allocationAmount.toString(),
    allocationRecipients:
      allocationAmount === 0n
        ? '0 (default)'
        : allocationRecipientIsDefault && expectedVestingRecipients.length === 1
          ? '1 (default)'
          : String(expectedVestingRecipients.length),
    vestMode: allocationModeDisplay,
    vestDuration: allocationDurationDisplay,
  };
  let submittedTxHash: `0x${string}` | undefined;
  launchSummaries.push(summary);

  const createPayload: CreateLaunchRequestInput = {
    chainId: chain.chainId,
    userAddress,
    integrationAddress: userAddress,
    tokenMetadata: {
      name: tokenName,
      symbol,
      tokenURI: tokenUri,
    },
    tokenomics: {
      totalSupply: totalSupply.toString(),
      ...(tokensForSale !== totalSupply ? { tokensForSale: tokensForSale.toString() } : {}),
      ...(allocationAmount > 0n && overrides?.allocations
        ? { allocations: overrides.allocations }
        : {}),
    },
    pricing: {
      numerairePriceUsd,
    },
    governance: overrides?.governance ?? false,
    migration: {
      type: 'noOp',
    },
    auction: {
      type: 'multicurve',
      curveConfig: {
        type: 'preset',
        presets: [preset],
        fee: feeConfig.fee,
      },
      initializer: initializerForPayload,
    },
  };

  try {
    verboseLog(liveDivider(`Creating Multicurve Token (${configLabel})`));
    if (liveVerbose) {
      printLiveTable('Launch Parameters', [
        ['Preset', preset],
        ['Chain ID', chain.chainId],
        ['RPC URL', chain.config.rpcUrl],
        ['User / Integrator', userAddress],
        ['Token', `${tokenName} (${symbol})`],
        ['Token URI', tokenUri],
        ['Supply / For Sale', `${totalSupply.toString()} / ${tokensForSale.toString()}`],
        ['Sale Percent', salePercentDisplay],
        ['Allocation Amount', summary.allocationAmount],
        ['Allocation Recipient', allocationRecipientDisplay],
        ['Allocation Split Count', summary.allocationRecipients],
        ['Allocation Lock Mode', allocationModeDisplay],
        ['Allocation Lock Duration (sec)', allocationDurationDisplay],
        ['Numeraire Price USD', numerairePriceUsd],
        ['Configured Fee', `${feeConfig.feePercent} (${feeConfig.fee})`],
        ['Tick Spacing', 'default (API derives for custom fee tiers)'],
        ['Initializer', requestedInitializer.type],
        [
          'Launch Mode',
          `multicurve + migration:noOp + governance:${overrides?.governance ? 'default' : 'none'}`,
        ],
      ]);
    }

    verboseLog('[live] checking RPC connectivity before submission');
    try {
      await chain.publicClient.getBlockNumber();
    } catch (error) {
      throw new Error(
        `Live RPC is unreachable at ${chain.config.rpcUrl}. Set RPC_URL/CHAIN_CONFIG_JSON to a reachable endpoint before running live tests.`,
        { cause: error as Error },
      );
    }

    const createResponse = await services.launchService.createLaunch(createPayload);
    expect(createResponse.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    submittedTxHash = createResponse.txHash;
    summary.txHash = createResponse.txHash;
    const txUrl = explorerBase ? `${explorerBase}/tx/${createResponse.txHash}` : null;
    if (liveVerbose) {
      printLiveTable('Submission Result', [
        ['Launch ID', createResponse.launchId],
        ['Tx', createResponse.txHash],
        ['BaseScan Tx', txUrl],
        ['Predicted Token', createResponse.predicted.tokenAddress],
        ['Predicted Pool ID', createResponse.predicted.poolId],
      ]);
    }

    const receipt = (await waitForReceipt(
      chain.publicClient as { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
      createResponse.txHash,
    )) as Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted onchain: ${createResponse.txHash}`);
    }

    const created = decodeCreateEvent(receipt.logs);
    expect(created).not.toBeNull();
    const createdEvent = created!;
    summary.tokenAddress = createdEvent.tokenAddress;
    summary.pureUrl = getPureTokenUrl(chain.chainId, createdEvent.tokenAddress) ?? undefined;

    const tx = (await waitForTransactionByHash({
      publicClient: chain.publicClient as {
        getTransaction: (...params: any[]) => Promise<unknown>;
      },
      txHash: createResponse.txHash,
    })) as Awaited<ReturnType<typeof chain.publicClient.getTransaction>>;
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });

    expect(decoded.functionName).toBe('create');
    const createArgs = (decoded.args ?? []) as readonly unknown[];
    const createArg = createArgs[0] as {
      initialSupply: bigint;
      numeraire: `0x${string}`;
      numTokensToSell: bigint;
      integrator: `0x${string}`;
      tokenFactoryData: `0x${string}`;
      poolInitializer: `0x${string}`;
      poolInitializerData: `0x${string}`;
    };

    expect(createArg.initialSupply.toString()).toBe(totalSupply.toString());
    expect(createArg.numTokensToSell.toString()).toBe(tokensForSale.toString());
    expect(createArg.integrator.toLowerCase()).toBe(userAddress.toLowerCase());
    expect(createArg.numeraire).not.toBe(zeroAddress);
    expect(createResponse.effectiveConfig.tokensForSale).toBe(tokensForSale.toString());
    expect(createResponse.effectiveConfig.allocationAmount).toBe(allocationAmount.toString());
    expect(createResponse.effectiveConfig.allocationRecipient.toLowerCase()).toBe(
      allocationRecipientAddress.toLowerCase(),
    );
    const effectiveRecipients = createResponse.effectiveConfig.allocationRecipients ?? [];
    expect(effectiveRecipients.length).toBe(expectedVestingRecipients.length);
    expect(effectiveRecipients.map((entry) => entry.address.toLowerCase())).toEqual(
      expectedVestingRecipients.map((entry) => entry.toLowerCase()),
    );
    expect(effectiveRecipients.map((entry) => entry.amount)).toEqual(
      expectedVestingAmounts.map((entry) => entry.toString()),
    );
    expect(createResponse.effectiveConfig.allocationLockMode).toBe(requestedAllocationMode);
    expect(createResponse.effectiveConfig.allocationLockDurationSeconds).toBe(
      allocationLockDurationSeconds,
    );
    expect(createResponse.effectiveConfig.initializer?.type).toBe(requestedInitializer.type);

    let decodedTokenFactoryData: ReturnType<typeof decodeStandardTokenFactoryData> | null = null;
    if (allocationAmount > 0n) {
      decodedTokenFactoryData = decodeStandardTokenFactoryData(createArg.tokenFactoryData);
      expect(decodedTokenFactoryData.vestingDuration).toBe(BigInt(allocationLockDurationSeconds));
      expect(decodedTokenFactoryData.recipients.length).toBe(expectedVestingRecipients.length);
      expect(decodedTokenFactoryData.amounts.length).toBe(expectedVestingAmounts.length);
      expect(
        decodedTokenFactoryData.recipients.map((recipient) => recipient.toLowerCase()),
      ).toEqual(expectedVestingRecipients.map((recipient) => recipient.toLowerCase()));
      expect(decodedTokenFactoryData.amounts.map((amount) => amount.toString())).toEqual(
        expectedVestingAmounts.map((amount) => amount.toString()),
      );
    }

    const expectedInitializerAddress = resolveExpectedMulticurveInitializer({
      chainAddresses: chain.addresses,
      initializerType: requestedInitializer.type,
    });
    expect(createArg.poolInitializer.toLowerCase()).toBe(expectedInitializerAddress.toLowerCase());

    const decodedPoolConfig = decodeInitializerPoolConfig(
      requestedInitializer.type,
      createArg.poolInitializerData,
    );
    expect(decodedPoolConfig.fee).toBe(feeConfig.fee);
    if (feeConfig.expectedTickSpacing > 0) {
      expect(decodedPoolConfig.tickSpacing).toBe(feeConfig.expectedTickSpacing);
    }
    if (requestedInitializer.type === 'standard') {
      expect(decodedPoolConfig.startingTime).toBe(0);
    } else if (requestedInitializer.type === 'scheduled') {
      expect(decodedPoolConfig.startingTime).toBe(requestedInitializer.startTime);
    } else if (requestedInitializer.type === 'decay') {
      expect(decodedPoolConfig.startFee).toBe(requestedInitializer.startFee);
      expect(decodedPoolConfig.durationSeconds).toBe(requestedInitializer.durationSeconds);
      expect(decodedPoolConfig.startingTime).toBe(requestedInitializer.startTime ?? 0);
    } else {
      expect(decodedPoolConfig.dopplerHook?.toLowerCase()).toBe(
        requestedInitializer.config.hookAddress!.toLowerCase(),
      );
      const rehypeInitCalldata = decodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        decodedPoolConfig.onInitializationDopplerHookCalldata ?? '0x',
      ) as readonly [`0x${string}`, `0x${string}`, number, bigint, bigint, bigint, bigint];

      expect(rehypeInitCalldata[1].toLowerCase()).toBe(
        requestedInitializer.config.buybackDestination.toLowerCase(),
      );
      expect(rehypeInitCalldata[2]).toBe(requestedInitializer.config.customFee);
      expect(rehypeInitCalldata[3].toString()).toBe(
        requestedInitializer.config.assetBuybackPercentWad,
      );
      expect(rehypeInitCalldata[4].toString()).toBe(
        requestedInitializer.config.numeraireBuybackPercentWad,
      );
      expect(rehypeInitCalldata[5].toString()).toBe(
        requestedInitializer.config.beneficiaryPercentWad,
      );
      expect(rehypeInitCalldata[6].toString()).toBe(requestedInitializer.config.lpPercentWad);
    }

    const status = await services.statusService.getLaunchStatus(createResponse.launchId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tokenAddress.toLowerCase()).toBe(createdEvent.tokenAddress.toLowerCase());

    const requestedNumeraire = createArg.numeraire.toLowerCase();
    let poolState: {
      currency0: `0x${string}`;
      currency1: `0x${string}`;
      numeraire: `0x${string}`;
      fee: number;
      tickSpacing: number;
      hooks: `0x${string}`;
    } | null = null;
    let poolNumeraire: string | null = null;
    let isNativeAlias = false;

    // DopplerHookInitializer state decoding does not share the v4Multicurve ABI shape.
    if (requestedInitializer.type !== 'rehype') {
      poolState = await readMulticurveStateWithRetry({
        publicClient: chain.publicClient,
        tokenAddress: createdEvent.tokenAddress,
        poolInitializer: createArg.poolInitializer,
      });
      poolNumeraire = poolState.numeraire.toLowerCase();
      const configuredWeth = (chain.addresses.weth as `0x${string}` | undefined)?.toLowerCase();
      isNativeAlias =
        poolNumeraire === zeroAddress && !!configuredWeth && requestedNumeraire === configuredWeth;

      expect(poolNumeraire === requestedNumeraire || isNativeAlias).toBe(true);
      expect(Number.isInteger(poolState.tickSpacing)).toBe(true);
      expect(poolState.tickSpacing).toBeGreaterThanOrEqual(0);
      expect(poolState.fee).toBeGreaterThanOrEqual(0);
      if (requestedInitializer.type === 'decay') {
        const poolId = computePoolId({
          currency0: poolState.currency0,
          currency1: poolState.currency1,
          fee: poolState.fee,
          tickSpacing: poolState.tickSpacing,
          hooks: poolState.hooks,
        }) as `0x${string}`;
        const feeSchedule = (await chain.publicClient.readContract({
          address: poolState.hooks,
          abi: decayMulticurveInitializerHookAbi,
          functionName: 'getFeeScheduleOf',
          args: [poolId],
        } as const)) as readonly [number, number, number, number, number];

        expect(feeSchedule[1]).toBe(requestedInitializer.startFee);
        expect(feeSchedule[2]).toBe(feeConfig.fee);
        expect(feeSchedule[4]).toBe(requestedInitializer.durationSeconds);
      }
    }

    const tokenUrl = explorerBase ? `${explorerBase}/token/${createdEvent.tokenAddress}` : null;
    const poolOrHookAddress = status.result?.poolOrHookAddress ?? createdEvent.poolOrHookAddress;
    const poolOrHookUrl = explorerBase ? `${explorerBase}/address/${poolOrHookAddress}` : null;
    if (liveVerbose) {
      printLiveTable('Onchain Verification', [
        ['Tx Status / Block', `${receipt.status} / ${receipt.blockNumber.toString()}`],
        ['Token Address', createdEvent.tokenAddress],
        ['Pool/Hook Address', poolOrHookAddress],
        ['Pool ID', status.result?.poolId ?? 'n/a'],
        [
          'InitialSupply / NumTokensToSell',
          `${createArg.initialSupply} / ${createArg.numTokensToSell}`,
        ],
        [
          'Vesting Duration / Recipient / Amount',
          decodedTokenFactoryData
            ? `${decodedTokenFactoryData.vestingDuration.toString()} / ${decodedTokenFactoryData.recipients[0] ?? 'none'} / ${decodedTokenFactoryData.amounts[0]?.toString() ?? '0'}`
            : 'n/a (no allocations)',
        ],
        [
          'Numeraire requested -> pool',
          requestedInitializer.type === 'rehype'
            ? `${requestedNumeraire} -> n/a (rehype initializer)`
            : `${requestedNumeraire} -> ${poolNumeraire}`,
        ],
        [
          'Numeraire Match',
          requestedInitializer.type === 'rehype'
            ? 'n/a (rehype initializer)'
            : poolNumeraire === requestedNumeraire || isNativeAlias
              ? 'yes'
              : 'no',
        ],
        [
          'TickSpacing / Fee (pool vs decoded)',
          requestedInitializer.type === 'rehype'
            ? `n/a (${decodedPoolConfig.tickSpacing} / ${decodedPoolConfig.fee})`
            : `${poolState!.tickSpacing} / ${poolState!.fee} (${decodedPoolConfig.tickSpacing} / ${decodedPoolConfig.fee})`,
        ],
        ['BaseScan Token', tokenUrl],
        ['BaseScan Pool/Hook', poolOrHookUrl],
      ]);
    }
    summary.status = 'created';
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose && submittedTxHash) {
      const txUrl = explorerBase ? `${explorerBase}/tx/${submittedTxHash}` : null;
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', submittedTxHash],
        ['BaseScan Tx', txUrl],
        ['Error', summary.reason],
      ]);
    } else if (liveVerbose) {
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', 'n/a (failed before tx submission)'],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  }
};

const runStaticLaunchAndVerify = async (args?: {
  governance?: boolean;
  curveConfig?:
    | {
        type: 'preset';
        preset: 'low' | 'medium' | 'high';
      }
    | {
        type: 'range';
        marketCapStartUsd: number;
        marketCapEndUsd: number;
      };
  configLabel?: string;
}) => {
  const config = loadConfig();
  const services = buildServices(config);
  const chain = services.chainRegistry.get(config.defaultChainId);
  const userAddress = privateKeyToAccount(config.privateKey).address;
  const runId = Date.now().toString();
  const symbol = `S${runId.slice(-4)}`;
  const tokenName = `Live STATIC ${runId.slice(-6)}`;
  const tokenUri = `ipfs://live-static-token/${runId}`;
  const totalSupply = DEFAULT_LIVE_TOTAL_SUPPLY;
  const explorerBase = getBaseScanUrl(chain.chainId);
  const numerairePriceUsd = Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000');
  const curveConfig = args?.curveConfig ?? ({ type: 'preset', preset: 'medium' } as const);
  const curveLabel =
    curveConfig.type === 'preset'
      ? `${curveConfig.preset.toUpperCase()} preset`
      : `range $${curveConfig.marketCapStartUsd}-$${curveConfig.marketCapEndUsd}`;
  const configLabel = args?.configLabel ?? `STATIC V3 Lockable (${curveLabel})`;
  const summary: LaunchSummaryRow = {
    config: configLabel,
    status: 'failed',
    salePercent: '100% (default)',
    allocationAmount: '0 (default)',
    allocationRecipients: '0 (default)',
    vestMode: 'none (default)',
    vestDuration: '0 (default)',
  };
  let submittedTxHash: `0x${string}` | undefined;
  launchSummaries.push(summary);

  if (!chain.config.auctionTypes.includes('static')) {
    chain.config.auctionTypes = [...chain.config.auctionTypes, 'static'];
    verboseLog(
      `[live] chain ${chain.chainId} missing static in auctionTypes; enabling static for this test run`,
    );
  }

  const lockableV3Initializer = chain.addresses.lockableV3Initializer as `0x${string}` | undefined;
  if (!lockableV3Initializer || lockableV3Initializer === zeroAddress) {
    throw new Error(
      `Chain ${chain.chainId} has no lockableV3Initializer configured; static lockable test cannot run.`,
    );
  }

  const createPayload: CreateLaunchRequestInput = {
    chainId: chain.chainId,
    userAddress,
    integrationAddress: userAddress,
    tokenMetadata: {
      name: tokenName,
      symbol,
      tokenURI: tokenUri,
    },
    tokenomics: {
      totalSupply: totalSupply.toString(),
    },
    pricing: {
      numerairePriceUsd,
    },
    governance: args?.governance ?? false,
    migration: {
      type: 'noOp',
    },
    auction: {
      type: 'static',
      curveConfig,
    },
  };

  try {
    verboseLog(liveDivider(`Creating Static V3 Token (${configLabel})`));
    if (liveVerbose) {
      printLiveTable('Static Launch Parameters', [
        [
          'Curve Config',
          curveConfig.type === 'preset'
            ? `preset:${curveConfig.preset}`
            : `range:${curveConfig.marketCapStartUsd}-${curveConfig.marketCapEndUsd}`,
        ],
        ['Chain ID', chain.chainId],
        ['RPC URL', chain.config.rpcUrl],
        ['User / Integrator', userAddress],
        ['Token', `${tokenName} (${symbol})`],
        ['Token URI', tokenUri],
        ['Supply / For Sale', `${totalSupply.toString()} / ${totalSupply.toString()}`],
        ['Sale Percent', '100% (default)'],
        ['Allocation Amount', '0 (default)'],
        ['Numeraire Price USD', numerairePriceUsd],
        ['Expected Initializer', lockableV3Initializer],
        [
          'Launch Mode',
          `static + migration:noOp + governance:${args?.governance ? 'default' : 'none'}`,
        ],
      ]);
    }

    verboseLog('[live] checking RPC connectivity before static submission');
    try {
      await chain.publicClient.getBlockNumber();
    } catch (error) {
      throw new Error(
        `Live RPC is unreachable at ${chain.config.rpcUrl}. Set RPC_URL/CHAIN_CONFIG_JSON to a reachable endpoint before running live tests.`,
        { cause: error as Error },
      );
    }

    const createResponse = await services.launchService.createLaunch(createPayload);
    expect(createResponse.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    submittedTxHash = createResponse.txHash;
    summary.txHash = createResponse.txHash;
    const txUrl = explorerBase ? `${explorerBase}/tx/${createResponse.txHash}` : null;
    if (liveVerbose) {
      printLiveTable('Static Submission Result', [
        ['Launch ID', createResponse.launchId],
        ['Tx', createResponse.txHash],
        ['BaseScan Tx', txUrl],
        ['Predicted Token', createResponse.predicted.tokenAddress],
        ['Predicted Pool ID', createResponse.predicted.poolId],
      ]);
    }

    const receipt = (await waitForReceipt(
      chain.publicClient as { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
      createResponse.txHash,
    )) as Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted onchain: ${createResponse.txHash}`);
    }

    const created = decodeCreateEvent(receipt.logs);
    expect(created).not.toBeNull();
    const createdEvent = created!;
    summary.tokenAddress = createdEvent.tokenAddress;
    summary.pureUrl = getPureTokenUrl(chain.chainId, createdEvent.tokenAddress) ?? undefined;

    const tx = (await waitForTransactionByHash({
      publicClient: chain.publicClient as {
        getTransaction: (...params: any[]) => Promise<unknown>;
      },
      txHash: createResponse.txHash,
    })) as Awaited<ReturnType<typeof chain.publicClient.getTransaction>>;
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });
    expect(decoded.functionName).toBe('create');
    const createArgs = (decoded.args ?? []) as readonly unknown[];
    const createArg = createArgs[0] as {
      initialSupply: bigint;
      numeraire: `0x${string}`;
      numTokensToSell: bigint;
      integrator: `0x${string}`;
      poolInitializer: `0x${string}`;
    };

    expect(createArg.initialSupply.toString()).toBe(totalSupply.toString());
    expect(createArg.numTokensToSell.toString()).toBe(totalSupply.toString());
    expect(createArg.integrator.toLowerCase()).toBe(userAddress.toLowerCase());
    expect(createArg.numeraire).not.toBe(zeroAddress);
    expect(createArg.poolInitializer.toLowerCase()).toBe(lockableV3Initializer.toLowerCase());
    expect(createResponse.effectiveConfig.tokensForSale).toBe(totalSupply.toString());
    expect(createResponse.effectiveConfig.allocationAmount).toBe('0');
    expect(createResponse.effectiveConfig.allocationLockMode).toBe('none');
    expect(createResponse.effectiveConfig.feeBeneficiariesSource).toBe('default');

    const expectedPoolId =
      `0x${createdEvent.poolOrHookAddress.slice(2).padStart(64, '0')}`.toLowerCase();
    expect(createResponse.predicted.poolId.toLowerCase()).toBe(expectedPoolId);

    const status = await services.statusService.getLaunchStatus(createResponse.launchId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tokenAddress.toLowerCase()).toBe(createdEvent.tokenAddress.toLowerCase());
    expect(status.result?.poolOrHookAddress.toLowerCase()).toBe(
      createdEvent.poolOrHookAddress.toLowerCase(),
    );
    expect(status.result?.poolId.toLowerCase()).toBe(expectedPoolId);

    if (liveVerbose) {
      const tokenUrl = explorerBase ? `${explorerBase}/token/${createdEvent.tokenAddress}` : null;
      const poolUrl = explorerBase
        ? `${explorerBase}/address/${createdEvent.poolOrHookAddress}`
        : null;
      printLiveTable('Static Onchain Verification', [
        ['Tx Status / Block', `${receipt.status} / ${receipt.blockNumber.toString()}`],
        ['Token Address', createdEvent.tokenAddress],
        ['Pool Address', createdEvent.poolOrHookAddress],
        ['Status Pool ID', status.result?.poolId ?? 'n/a'],
        ['Expected Lockable Initializer', lockableV3Initializer],
        ['BaseScan Token', tokenUrl],
        ['BaseScan Pool', poolUrl],
      ]);
    }

    summary.status = 'created';
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose && submittedTxHash) {
      const txUrl = explorerBase ? `${explorerBase}/tx/${submittedTxHash}` : null;
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', submittedTxHash],
        ['BaseScan Tx', txUrl],
        ['Error', summary.reason],
      ]);
    } else if (liveVerbose) {
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', 'n/a (failed before tx submission)'],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  }
};

const runDynamicLaunchAndVerify = async (args?: {
  governance?: boolean;
  configLabel?: string;
  marketCapStartUsd?: number;
  marketCapMinUsd?: number;
  minProceeds?: string;
  maxProceeds?: string;
  durationSeconds?: number;
  epochLengthSeconds?: number;
}) => {
  const config = loadConfig();
  const services = buildServices(config);
  const chain = services.chainRegistry.get(config.defaultChainId);
  const userAddress = privateKeyToAccount(config.privateKey).address;
  const runId = Date.now().toString();
  const symbol = `D${runId.slice(-4)}`;
  const tokenName = `Live DYNAMIC ${runId.slice(-6)}`;
  const tokenUri = `ipfs://live-dynamic-token/${runId}`;
  const totalSupply = DEFAULT_LIVE_TOTAL_SUPPLY;
  const explorerBase = getBaseScanUrl(chain.chainId);
  const numerairePriceUsd = Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000');
  const marketCapStartUsd = args?.marketCapStartUsd ?? 100;
  const marketCapMinUsd = args?.marketCapMinUsd ?? 50;
  const minProceeds = args?.minProceeds ?? '0.01';
  const maxProceeds = args?.maxProceeds ?? '0.1';
  const durationSeconds = args?.durationSeconds ?? 24 * 60 * 60;
  const epochLengthSeconds = args?.epochLengthSeconds;
  const configLabel =
    args?.configLabel ??
    `DYNAMIC V4 (start $${marketCapStartUsd}, minProceeds ${minProceeds}, maxProceeds ${maxProceeds}, ${durationSeconds}s, epoch ${epochLengthSeconds ?? 'default'})`;
  const summary: LaunchSummaryRow = {
    config: configLabel,
    status: 'failed',
    salePercent: '100% (default)',
    allocationAmount: '0 (default)',
    allocationRecipients: '0 (default)',
    vestMode: 'none (default)',
    vestDuration: '0 (default)',
  };
  let submittedTxHash: `0x${string}` | undefined;
  launchSummaries.push(summary);

  if (chain.chainId !== 84532) {
    throw new Error(
      `Dynamic live MVP test is restricted to Base Sepolia (84532); current chain is ${chain.chainId}`,
    );
  }

  if (!chain.config.auctionTypes.includes('dynamic')) {
    chain.config.auctionTypes = [...chain.config.auctionTypes, 'dynamic'];
    verboseLog(
      `[live] chain ${chain.chainId} missing dynamic in auctionTypes; enabling dynamic for this test run`,
    );
  }

  if (!chain.config.migrationModes.includes('uniswapV2')) {
    chain.config.migrationModes = [...chain.config.migrationModes, 'uniswapV2'];
    verboseLog(
      `[live] chain ${chain.chainId} missing uniswapV2 in migrationModes; enabling uniswapV2 for this test run`,
    );
  }

  const expectedMinProceeds = parseEther(minProceeds);
  const expectedMaxProceeds = parseEther(maxProceeds);

  const createPayload: CreateLaunchRequestInput = {
    chainId: chain.chainId,
    userAddress,
    integrationAddress: userAddress,
    tokenMetadata: {
      name: tokenName,
      symbol,
      tokenURI: tokenUri,
    },
    tokenomics: {
      totalSupply: totalSupply.toString(),
    },
    pricing: {
      numerairePriceUsd,
    },
    governance: args?.governance ?? false,
    migration: {
      type: 'uniswapV2',
    },
    auction: {
      type: 'dynamic',
      curveConfig: {
        type: 'range',
        marketCapStartUsd,
        marketCapMinUsd,
        minProceeds,
        maxProceeds,
        durationSeconds,
        ...(epochLengthSeconds !== undefined ? { epochLengthSeconds } : {}),
      },
    },
  };

  try {
    verboseLog(liveDivider(`Creating Dynamic V4 Token (${configLabel})`));
    if (liveVerbose) {
      printLiveTable('Dynamic Launch Parameters', [
        ['Chain ID', chain.chainId],
        ['RPC URL', chain.config.rpcUrl],
        ['User / Integrator', userAddress],
        ['Token', `${tokenName} (${symbol})`],
        ['Token URI', tokenUri],
        ['Supply / For Sale', `${totalSupply.toString()} / ${totalSupply.toString()}`],
        ['Market Cap Start / Min USD', `${marketCapStartUsd} / ${marketCapMinUsd}`],
        ['Min / Max Proceeds', `${minProceeds} / ${maxProceeds}`],
        ['Duration (sec)', durationSeconds],
        ['Epoch Length (sec)', epochLengthSeconds ?? 'default (SDK)'],
        ['Numeraire Price USD', numerairePriceUsd],
        [
          'Launch Mode',
          `dynamic + migration:uniswapV2 + governance:${args?.governance ? 'default' : 'none'}`,
        ],
      ]);
    }

    verboseLog('[live] checking RPC connectivity before dynamic submission');
    try {
      await chain.publicClient.getBlockNumber();
    } catch (error) {
      throw new Error(
        `Live RPC is unreachable at ${chain.config.rpcUrl}. Set RPC_URL/CHAIN_CONFIG_JSON to a reachable endpoint before running live tests.`,
        { cause: error as Error },
      );
    }

    const createResponse = await services.launchService.createLaunch(createPayload);
    expect(createResponse.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    submittedTxHash = createResponse.txHash;
    summary.txHash = createResponse.txHash;
    const txUrl = explorerBase ? `${explorerBase}/tx/${createResponse.txHash}` : null;
    if (liveVerbose) {
      printLiveTable('Dynamic Submission Result', [
        ['Launch ID', createResponse.launchId],
        ['Tx', createResponse.txHash],
        ['BaseScan Tx', txUrl],
        ['Predicted Token', createResponse.predicted.tokenAddress],
        ['Predicted Pool ID', createResponse.predicted.poolId],
      ]);
    }

    const receipt = (await waitForReceipt(
      chain.publicClient as { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
      createResponse.txHash,
    )) as Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted onchain: ${createResponse.txHash}`);
    }

    const created = decodeCreateEvent(receipt.logs);
    expect(created).not.toBeNull();
    const createdEvent = created!;
    summary.tokenAddress = createdEvent.tokenAddress;
    summary.pureUrl = getPureTokenUrl(chain.chainId, createdEvent.tokenAddress) ?? undefined;

    const tx = (await waitForTransactionByHash({
      publicClient: chain.publicClient as {
        getTransaction: (...params: any[]) => Promise<unknown>;
      },
      txHash: createResponse.txHash,
    })) as Awaited<ReturnType<typeof chain.publicClient.getTransaction>>;
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });
    expect(decoded.functionName).toBe('create');
    const createArgs = (decoded.args ?? []) as readonly unknown[];
    const createArg = createArgs[0] as {
      initialSupply: bigint;
      numeraire: `0x${string}`;
      numTokensToSell: bigint;
      integrator: `0x${string}`;
      poolInitializer: `0x${string}`;
      poolInitializerData: `0x${string}`;
      liquidityMigrator: `0x${string}`;
    };

    expect(createArg.initialSupply.toString()).toBe(totalSupply.toString());
    expect(createArg.numTokensToSell.toString()).toBe(totalSupply.toString());
    expect(createArg.integrator.toLowerCase()).toBe(userAddress.toLowerCase());
    expect(createArg.numeraire).not.toBe(zeroAddress);
    expect(createArg.poolInitializer.toLowerCase()).toBe(
      chain.addresses.v4Initializer.toLowerCase(),
    );
    expect(createArg.liquidityMigrator.toLowerCase()).toBe(
      chain.addresses.v2Migrator.toLowerCase(),
    );

    const status = await services.statusService.getLaunchStatus(createResponse.launchId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tokenAddress.toLowerCase()).toBe(createdEvent.tokenAddress.toLowerCase());
    expect(status.result?.poolOrHookAddress.toLowerCase()).toBe(
      createdEvent.poolOrHookAddress.toLowerCase(),
    );
    expect(status.result?.poolId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(createResponse.predicted.poolId).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const decodedDynamicConfig = decodeDynamicPoolConfig(createArg.poolInitializerData);
    expect(decodedDynamicConfig.minimumProceeds).toBe(expectedMinProceeds);
    expect(decodedDynamicConfig.maximumProceeds).toBe(expectedMaxProceeds);
    expect(decodedDynamicConfig.endingTime - decodedDynamicConfig.startingTime).toBe(
      BigInt(durationSeconds),
    );
    expect(decodedDynamicConfig.startingTime).toBeGreaterThan(0n);
    expect(decodedDynamicConfig.endingTime).toBeGreaterThan(decodedDynamicConfig.startingTime);
    summary.status = 'created';
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose && submittedTxHash) {
      const txUrl = explorerBase ? `${explorerBase}/tx/${submittedTxHash}` : null;
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', submittedTxHash],
        ['BaseScan Tx', txUrl],
        ['Error', summary.reason],
      ]);
    } else if (liveVerbose) {
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', 'n/a (failed before tx submission)'],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  }
};

const runCustomCurveLaunchAndVerify = async () => {
  const config = loadConfig();
  const services = buildServices(config);
  const chain = services.chainRegistry.get(config.defaultChainId);
  const userAddress = privateKeyToAccount(config.privateKey).address;
  const runId = Date.now().toString();
  const symbol = `C${runId.slice(-4)}`;
  const tokenName = `Live CUSTOM ${runId.slice(-6)}`;
  const tokenUri = `ipfs://live-test-token/${runId}`;
  const totalSupply = (1_000_000n * 10n ** 18n).toString();
  const explorerBase = getBaseScanUrl(chain.chainId);
  const numerairePriceUsd = Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000');
  const randomFeePercent = randomFeePercentTwoDecimals();
  const randomFeeUnits = percentToFeeUnits(randomFeePercent);
  const customTickSpacing = 200;
  const customFiniteMaxMarketCapUsd = 1_000_000_000_000_000;
  const customCurvePlan = buildRandomCustomCurvePlan(customFiniteMaxMarketCapUsd);
  const expectedSharesWad = customCurvePlan.curves.map((curve) => curve.sharesWad);
  const configLabel = 'Custom Curve Configuration';
  const summary: LaunchSummaryRow = {
    config: configLabel,
    status: 'failed',
    salePercent: '100% (default)',
    allocationAmount: '0 (default)',
    allocationRecipients: '0 (default)',
    vestMode: 'none (default)',
    vestDuration: '0 (default)',
  };
  let submittedTxHash: `0x${string}` | undefined;
  launchSummaries.push(summary);

  const createPayload: CreateLaunchRequestInput = {
    chainId: chain.chainId,
    userAddress,
    integrationAddress: userAddress,
    tokenMetadata: {
      name: tokenName,
      symbol,
      tokenURI: tokenUri,
    },
    tokenomics: {
      totalSupply,
    },
    pricing: {
      numerairePriceUsd,
    },
    governance: {
      enabled: false,
      mode: 'noOp',
    },
    migration: {
      type: 'noOp',
    },
    auction: {
      type: 'multicurve',
      curveConfig: {
        type: 'ranges',
        fee: randomFeeUnits,
        tickSpacing: customTickSpacing,
        curves: customCurvePlan.curves,
      },
    },
  };

  try {
    expect(customCurvePlan.curves.length).toBeGreaterThan(2);
    expect(customCurvePlan.curves.length).toBeLessThan(5);
    expect(customCurvePlan.curves[customCurvePlan.curves.length - 1]?.marketCapEndUsd).toBe(
      customFiniteMaxMarketCapUsd,
    );
    const totalSharesWad = customCurvePlan.curves.reduce(
      (sum, curve) => sum + BigInt(curve.sharesWad),
      0n,
    );
    expect(totalSharesWad).toBe(10n ** 18n);
    for (let i = 1; i < customCurvePlan.curves.length; i += 1) {
      expect(customCurvePlan.curves[i]?.marketCapStartUsd).toBe(
        customCurvePlan.curves[i - 1]?.marketCapEndUsd,
      );
    }

    verboseLog(liveDivider(`Creating Multicurve Token (${configLabel})`));
    const curveRows: Array<[string, string]> = customCurvePlan.curves.map((curve, index) => [
      `Curve ${index + 1}`,
      `${curve.marketCapStartUsd}-${curve.marketCapEndUsd} USD -> ${(customCurvePlan.shareBps[index]! / 100).toFixed(2)}%`,
    ]);
    if (liveVerbose) {
      printLiveTable('Launch Parameters', [
        ['Chain ID', chain.chainId],
        ['RPC URL', chain.config.rpcUrl],
        ['User / Integrator', userAddress],
        ['Token', `${tokenName} (${symbol})`],
        ['Token URI', tokenUri],
        ['Supply / For Sale', `${totalSupply} / ${totalSupply}`],
        ['Sale Percent', '100% (default)'],
        ['Allocation Amount', '0 (default)'],
        ['Allocation Lock Mode / Duration', 'none (default) / 0 (default)'],
        ['Numeraire Price USD', numerairePriceUsd],
        ['Curve Count', customCurvePlan.curves.length],
        ...curveRows,
        ['Final Curve End', customFiniteMaxMarketCapUsd.toLocaleString()],
        [
          'Fee / TickSpacing',
          `${randomFeePercent.toFixed(2)}% (${randomFeeUnits}) / ${customTickSpacing}`,
        ],
        ['Launch Mode', 'multicurve + migration:noOp + governance:noOp'],
      ]);
    }

    verboseLog('[live] checking RPC connectivity before submission');
    try {
      await chain.publicClient.getBlockNumber();
    } catch (error) {
      throw new Error(
        `Live RPC is unreachable at ${chain.config.rpcUrl}. Set RPC_URL/CHAIN_CONFIG_JSON to a reachable endpoint before running live tests.`,
        { cause: error as Error },
      );
    }

    const createResponse = await services.launchService.createLaunch(createPayload);
    expect(createResponse.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    submittedTxHash = createResponse.txHash;
    summary.txHash = createResponse.txHash;
    const txUrl = explorerBase ? `${explorerBase}/tx/${createResponse.txHash}` : null;
    if (liveVerbose) {
      printLiveTable('Submission Result', [
        ['Launch ID', createResponse.launchId],
        ['Tx', createResponse.txHash],
        ['BaseScan Tx', txUrl],
        ['Predicted Token', createResponse.predicted.tokenAddress],
        ['Predicted Pool ID', createResponse.predicted.poolId],
      ]);
    }

    const receipt = (await waitForReceipt(
      chain.publicClient as { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
      createResponse.txHash,
    )) as Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted onchain: ${createResponse.txHash}`);
    }

    const created = decodeCreateEvent(receipt.logs);
    expect(created).not.toBeNull();
    const createdEvent = created!;
    summary.tokenAddress = createdEvent.tokenAddress;
    summary.pureUrl = getPureTokenUrl(chain.chainId, createdEvent.tokenAddress) ?? undefined;

    const tx = (await waitForTransactionByHash({
      publicClient: chain.publicClient as {
        getTransaction: (...params: any[]) => Promise<unknown>;
      },
      txHash: createResponse.txHash,
    })) as Awaited<ReturnType<typeof chain.publicClient.getTransaction>>;
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });

    expect(decoded.functionName).toBe('create');
    const createArgs = (decoded.args ?? []) as readonly unknown[];
    const createArg = createArgs[0] as {
      numeraire: `0x${string}`;
      numTokensToSell: bigint;
      integrator: `0x${string}`;
      poolInitializer: `0x${string}`;
      poolInitializerData: `0x${string}`;
    };

    expect(createArg.numTokensToSell.toString()).toBe(totalSupply);
    expect(createArg.integrator.toLowerCase()).toBe(userAddress.toLowerCase());
    expect(createArg.numeraire).not.toBe(zeroAddress);

    const decodedPoolConfig = decodeInitializerPoolConfig(
      'standard',
      createArg.poolInitializerData,
    );

    expect(decodedPoolConfig.fee).toBe(randomFeeUnits);
    expect(decodedPoolConfig.tickSpacing).toBe(customTickSpacing);
    expect(decodedPoolConfig.startingTime).toBe(0);
    expect(decodedPoolConfig.curves.length).toBe(customCurvePlan.curves.length);
    const shares = decodedPoolConfig.curves.map((curve) => curve.shares.toString());
    expect(shares).toEqual(expectedSharesWad);

    const status = await services.statusService.getLaunchStatus(createResponse.launchId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tokenAddress.toLowerCase()).toBe(createdEvent.tokenAddress.toLowerCase());

    const poolState = await readMulticurveStateWithRetry({
      publicClient: chain.publicClient,
      tokenAddress: createdEvent.tokenAddress,
      poolInitializer: createArg.poolInitializer,
    });

    if (liveVerbose) {
      printLiveTable('Onchain Verification', [
        ['Tx Status / Block', `${receipt.status} / ${receipt.blockNumber.toString()}`],
        ['Token Address', createdEvent.tokenAddress],
        ['Pool ID', status.result?.poolId ?? 'n/a'],
        [
          'Fee / TickSpacing (pool vs decoded)',
          `${poolState.fee} / ${poolState.tickSpacing} (${decodedPoolConfig.fee} / ${decodedPoolConfig.tickSpacing})`,
        ],
        ['Curve Count', customCurvePlan.curves.length],
        ['Curve Shares (decoded)', shares.join(', ')],
        ['Pure URL', summary.pureUrl ?? 'n/a'],
      ]);
    }
    summary.status = 'created';
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose && submittedTxHash) {
      const txUrl = explorerBase ? `${explorerBase}/tx/${submittedTxHash}` : null;
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', submittedTxHash],
        ['BaseScan Tx', txUrl],
        ['Error', summary.reason],
      ]);
    } else if (liveVerbose) {
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', 'n/a (failed before tx submission)'],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  }
};

const runCustomCurveWithRandomVestingAndAllocations = async () => {
  const config = loadConfig();
  const services = buildServices(config);
  const chain = services.chainRegistry.get(config.defaultChainId);
  const userAddress = privateKeyToAccount(config.privateKey).address;
  const runId = Date.now().toString();
  const symbol = `R${runId.slice(-4)}`;
  const tokenName = `Live RAND ${runId.slice(-6)}`;
  const tokenUri = `ipfs://live-test-token/${runId}`;
  const totalSupply = DEFAULT_LIVE_TOTAL_SUPPLY;
  const explorerBase = getBaseScanUrl(chain.chainId);
  const numerairePriceUsd = Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000');
  const randomFeePercent = randomFeePercentTwoDecimals();
  const randomFeeUnits = percentToFeeUnits(randomFeePercent);
  const tickSpacing = 200;
  const customFiniteMaxMarketCapUsd = 1_000_000_000_000_000;
  const customCurvePlan = buildRandomCustomCurvePlan(customFiniteMaxMarketCapUsd);
  const expectedSharesWad = customCurvePlan.curves.map((curve) => curve.sharesWad);

  const salePercent = 20 + Math.floor(Math.random() * 31); // 20-50%
  const tokensForSale = calculateSaleAmount(totalSupply, salePercent);
  const allocationAmount = totalSupply - tokensForSale;
  const recipientCount = 3 + Math.floor(Math.random() * 3); // 3-5
  const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);
  const vestDays = 91 + Math.floor(Math.random() * 274); // 91-364
  const vestDurationSeconds = vestDays * 24 * 60 * 60;
  const cliffDurationSeconds = Math.floor(
    Math.random() * Math.max(1, Math.floor(vestDurationSeconds / 4)),
  );
  const configLabel = `Custom Curve + Random Vest (${vestDays}d, ${recipientCount} recipients)`;
  const summary: LaunchSummaryRow = {
    config: configLabel,
    status: 'failed',
    salePercent: `${salePercent}%`,
    allocationAmount: allocationAmount.toString(),
    allocationRecipients: String(recipientCount),
    vestMode: 'vest',
    vestDuration: String(vestDurationSeconds),
  };
  let submittedTxHash: `0x${string}` | undefined;
  launchSummaries.push(summary);

  const createPayload: CreateLaunchRequestInput = {
    chainId: chain.chainId,
    userAddress,
    integrationAddress: userAddress,
    tokenMetadata: {
      name: tokenName,
      symbol,
      tokenURI: tokenUri,
    },
    tokenomics: {
      totalSupply: totalSupply.toString(),
      tokensForSale: tokensForSale.toString(),
      allocations: {
        mode: 'vest',
        durationSeconds: vestDurationSeconds,
        cliffDurationSeconds,
        allocations,
      },
    },
    pricing: {
      numerairePriceUsd,
    },
    governance: false,
    migration: {
      type: 'noOp',
    },
    auction: {
      type: 'multicurve',
      curveConfig: {
        type: 'ranges',
        fee: randomFeeUnits,
        tickSpacing,
        curves: customCurvePlan.curves,
      },
    },
  };

  try {
    verboseLog(liveDivider(`Creating Multicurve Token (${configLabel})`));
    if (liveVerbose) {
      printLiveTable('Launch Parameters', [
        ['Chain ID', chain.chainId],
        ['RPC URL', chain.config.rpcUrl],
        ['User / Integrator', userAddress],
        ['Token', `${tokenName} (${symbol})`],
        ['Token URI', tokenUri],
        ['Supply / For Sale', `${totalSupply.toString()} / ${tokensForSale.toString()}`],
        ['Sale Percent', `${salePercent}%`],
        ['Allocation Amount', allocationAmount.toString()],
        ['Allocation Recipients', recipientCount],
        ['Vesting Mode', 'vest'],
        ['Vesting Duration (sec)', vestDurationSeconds],
        ['Vesting Cliff (sec)', cliffDurationSeconds],
        ['Curve Count', customCurvePlan.curves.length],
        [
          'Fee / TickSpacing',
          `${randomFeePercent.toFixed(2)}% (${randomFeeUnits}) / ${tickSpacing}`,
        ],
      ]);
    }

    verboseLog('[live] checking RPC connectivity before submission');
    try {
      await chain.publicClient.getBlockNumber();
    } catch (error) {
      throw new Error(
        `Live RPC is unreachable at ${chain.config.rpcUrl}. Set RPC_URL/CHAIN_CONFIG_JSON to a reachable endpoint before running live tests.`,
        { cause: error as Error },
      );
    }

    const createResponse = await services.launchService.createLaunch(createPayload);
    expect(createResponse.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    submittedTxHash = createResponse.txHash;
    summary.txHash = createResponse.txHash;

    const receipt = (await waitForReceipt(
      chain.publicClient as { waitForTransactionReceipt: (...params: any[]) => Promise<unknown> },
      createResponse.txHash,
    )) as Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;

    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted onchain: ${createResponse.txHash}`);
    }

    const created = decodeCreateEvent(receipt.logs);
    expect(created).not.toBeNull();
    const createdEvent = created!;
    summary.tokenAddress = createdEvent.tokenAddress;
    summary.pureUrl = getPureTokenUrl(chain.chainId, createdEvent.tokenAddress) ?? undefined;

    expect(createResponse.effectiveConfig.tokensForSale).toBe(tokensForSale.toString());
    expect(createResponse.effectiveConfig.allocationAmount).toBe(allocationAmount.toString());
    expect(createResponse.effectiveConfig.allocationRecipient.toLowerCase()).toBe(
      allocations[0]!.address.toLowerCase(),
    );
    expect(createResponse.effectiveConfig.allocationRecipients?.length ?? 0).toBe(recipientCount);
    expect(createResponse.effectiveConfig.allocationLockMode).toBe('vest');
    expect(createResponse.effectiveConfig.allocationLockDurationSeconds).toBe(vestDurationSeconds);

    const tx = (await waitForTransactionByHash({
      publicClient: chain.publicClient as {
        getTransaction: (...params: any[]) => Promise<unknown>;
      },
      txHash: createResponse.txHash,
    })) as Awaited<ReturnType<typeof chain.publicClient.getTransaction>>;
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });
    expect(decoded.functionName).toBe('create');
    const createArg = ((decoded.args ?? [])[0] ?? {}) as {
      tokenFactoryData: `0x${string}`;
      poolInitializerData: `0x${string}`;
      poolInitializer: `0x${string}`;
      numeraire: `0x${string}`;
      numTokensToSell: bigint;
    };

    expect(createArg.numTokensToSell.toString()).toBe(tokensForSale.toString());

    const decodedTokenFactoryData = decodeStandardTokenFactoryData(createArg.tokenFactoryData);
    expect(decodedTokenFactoryData.vestingDuration).toBe(BigInt(vestDurationSeconds));
    expect(decodedTokenFactoryData.recipients.map((entry) => entry.toLowerCase())).toEqual(
      allocations.map((entry) => entry.address.toLowerCase()),
    );
    expect(decodedTokenFactoryData.amounts.map((entry) => entry.toString())).toEqual(
      allocations.map((entry) => entry.amount),
    );

    const decodedPoolConfig = decodeInitializerPoolConfig(
      'standard',
      createArg.poolInitializerData,
    );
    expect(decodedPoolConfig.fee).toBe(randomFeeUnits);
    expect(decodedPoolConfig.tickSpacing).toBe(tickSpacing);
    expect(decodedPoolConfig.startingTime).toBe(0);
    expect(decodedPoolConfig.curves.map((curve) => curve.shares.toString())).toEqual(
      expectedSharesWad,
    );

    const status = await services.statusService.getLaunchStatus(createResponse.launchId);
    expect(status.status).toBe('confirmed');
    expect(status.result?.tokenAddress.toLowerCase()).toBe(createdEvent.tokenAddress.toLowerCase());

    const poolState = await readMulticurveStateWithRetry({
      publicClient: chain.publicClient,
      tokenAddress: createdEvent.tokenAddress,
      poolInitializer: createArg.poolInitializer,
    });
    expect(poolState.fee).toBeGreaterThanOrEqual(0);
    expect(poolState.tickSpacing).toBeGreaterThanOrEqual(0);
    summary.status = 'created';
  } catch (error) {
    summary.reason = toShortError(error);
    if (liveVerbose && submittedTxHash) {
      const txUrl = explorerBase ? `${explorerBase}/tx/${submittedTxHash}` : null;
      printLiveTable('Failure Context', [
        ['Configuration', configLabel],
        ['Submitted Tx', submittedTxHash],
        ['BaseScan Tx', txUrl],
        ['Error', summary.reason],
      ]);
    }
    throw error;
  }
};

describe('live create verification', () => {
  beforeAll(async () => {
    if (!runLive) return;

    const config = loadConfig();
    const services = buildServices(config);
    const chain = services.chainRegistry.get(config.defaultChainId);
    const signerAddress = privateKeyToAccount(config.privateKey).address;
    let requirement: ReturnType<typeof buildLiveBalanceRequirement>;

    try {
      requirement = buildLiveBalanceRequirement({
        liveFilter,
        minBalanceEth: process.env.LIVE_TEST_MIN_BALANCE_ETH,
        estimatedTxCostEth: process.env.LIVE_TEST_ESTIMATED_TX_COST_ETH,
        estimatedOverheadEth: process.env.LIVE_TEST_ESTIMATED_OVERHEAD_ETH,
      });
    } catch (error) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Invalid live test readiness configuration: ${toShortError(error)}.`,
        { cause: error as Error },
      );
    }

    if (!requirement) return;

    let signerBalance: bigint;
    try {
      signerBalance = await chain.publicClient.getBalance({ address: signerAddress });
    } catch (error) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Could not fetch balance for signer ${signerAddress} on chain ${chain.chainId} (${chain.config.rpcUrl}). Ensure RPC_URL/CHAIN_CONFIG_JSON is reachable before running live tests.`,
        { cause: error as Error },
      );
    }

    if (signerBalance < requirement.requiredWei) {
      throw new Error(
        `[${LIVE_READINESS_ERROR_MARKER}] Insufficient estimated balance for LIVE_TEST_FILTER=${liveFilter}. Signer ${signerAddress} on chain ${chain.chainId} has ${formatEther(signerBalance)} ETH, but requires at least ${formatEther(requirement.requiredWei)} ETH (${requirement.reason}). Fund this signer or adjust LIVE_TEST_MIN_BALANCE_ETH / LIVE_TEST_ESTIMATED_TX_COST_ETH / LIVE_TEST_ESTIMATED_OVERHEAD_ETH.`,
      );
    }
  });

  afterAll(async () => {
    printLiveMatrix(
      'Launch Summary',
      [
        'Configuration',
        'Result',
        'Sale %',
        'Allocation Amount',
        'Recipients',
        'Vest Mode',
        'Vest Duration (s)',
        'Pure URL',
      ],
      launchSummaries.map((row) => [
        row.config,
        row.status,
        row.salePercent ?? 'n/a',
        row.allocationAmount ?? 'n/a',
        row.allocationRecipients ?? 'n/a',
        row.vestMode ?? 'n/a',
        row.vestDuration ?? 'n/a',
        row.pureUrl ?? (row.status === 'failed' ? `n/a (${row.reason ?? 'launch failed'})` : 'n/a'),
      ]),
    );

    const failedLaunches = launchSummaries.filter((row) => row.status === 'failed');
    if (liveVerbose && failedLaunches.length > 0) {
      printLiveMatrix(
        'Failed Launches',
        ['Configuration', 'Submitted Tx', 'Reason'],
        failedLaunches.map((row) => [row.config, row.txHash ?? 'n/a', row.reason ?? 'unknown']),
      );
    }
  });

  liveIt(
    'LOW Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('low');
    },
    240_000,
  );

  liveIt(
    'MEDIUM Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('medium');
    },
    240_000,
  );

  liveIt(
    'HIGH Default Configuration',
    ['multicurve', 'multicurve-defaults'],
    async () => {
      await runMulticurveLaunchAndVerify('high');
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Lockable (MEDIUM preset)',
    ['static'],
    async () => {
      await runStaticLaunchAndVerify({
        curveConfig: { type: 'preset', preset: 'medium' },
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Lockable (Range $100-$100000)',
    ['static'],
    async () => {
      await runStaticLaunchAndVerify({
        curveConfig: {
          type: 'range',
          marketCapStartUsd: 100,
          marketCapEndUsd: 100000,
        },
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 (Range $100->$50, min 0.01, max 0.1, 24h)',
    ['dynamic'],
    async () => {
      await runDynamicLaunchAndVerify({
        marketCapStartUsd: 100,
        marketCapMinUsd: 50,
        minProceeds: '0.01',
        maxProceeds: '0.1',
        durationSeconds: 24 * 60 * 60,
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM 20% Sale / 80% Allocation (Default Lock)',
    ['multicurve'],
    async () => {
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: 'MEDIUM 20% Sale / 80% Allocation',
        salePercent: 20,
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Random 30-50% Sale / Allocation Remainder',
    ['multicurve'],
    async () => {
      const randomSalePercent = 30 + Math.floor(Math.random() * 21);
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random ${randomSalePercent}% Sale / ${100 - randomSalePercent}% Allocation`,
        salePercent: randomSalePercent,
        allocations: {
          mode: 'vault',
          durationSeconds: 45 * 24 * 60 * 60,
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Random 3-5 Address Allocation Split',
    ['multicurve'],
    async () => {
      const randomSalePercent = 20 + Math.floor(Math.random() * 31);
      const tokensForSale = calculateSaleAmount(DEFAULT_LIVE_TOTAL_SUPPLY, randomSalePercent);
      const allocationAmount = DEFAULT_LIVE_TOTAL_SUPPLY - tokensForSale;
      const recipientCount = 3 + Math.floor(Math.random() * 3);
      const allocations = buildRandomAddressAllocations(allocationAmount, recipientCount);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Random Split (${recipientCount} recipients, ${randomSalePercent}% market)`,
        salePercent: randomSalePercent,
        allocations: {
          mode: 'vest',
          durationSeconds: 60 * 24 * 60 * 60,
          allocations,
        },
      });
    },
    240_000,
  );

  liveIt(
    'Custom Curve Configuration',
    ['multicurve'],
    async () => {
      await runCustomCurveLaunchAndVerify();
    },
    240_000,
  );

  liveIt(
    'Custom Curve + Random Vesting (91-364d) + Random Allocations',
    ['multicurve'],
    async () => {
      await runCustomCurveWithRandomVestingAndAllocations();
    },
    240_000,
  );

  liveIt(
    'MEDIUM Scheduled Initializer (+360s, 80/20)',
    ['multicurve'],
    async () => {
      const startTime = Math.floor(Date.now() / 1000) + 360;
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: 'MEDIUM Scheduled Initializer (+360s, 80/20)',
        salePercent: 80,
        initializer: {
          type: 'scheduled',
          startTime,
        },
      });
    },
    240_000,
  );

  liveIt(
    'HIGH Decay Initializer (Random 40-80% -> 1%, 30-90s, 80/20)',
    ['multicurve'],
    async () => {
      const startFeePercent = 40 + Math.floor(Math.random() * 41);
      const startFee = percentToFeeUnits(startFeePercent);
      const durationSeconds = 30 + Math.floor(Math.random() * 61);
      await runMulticurveLaunchAndVerify('high', {
        configLabel: `HIGH Decay Initializer (${startFeePercent}% -> 1%, ${durationSeconds}s, 80/20)`,
        salePercent: 80,
        initializer: {
          type: 'decay',
          startFee,
          durationSeconds,
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Rehype Initializer (Random Config, 100% Buyback/Burn to Dead, 80/20)',
    ['multicurve'],
    async () => {
      const assetBuybackBps = 10_000;
      const assetBuybackPercentWad = ((WAD * BigInt(assetBuybackBps)) / 10_000n).toString();
      const numeraireBuybackPercentWad = (WAD - BigInt(assetBuybackPercentWad)).toString();
      const customFee = 500 + Math.floor(Math.random() * 50_001);

      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Rehype Initializer (asset buyback ${assetBuybackBps / 100}%, 80/20)`,
        salePercent: 80,
        initializer: {
          type: 'rehype',
          config: {
            buybackDestination: DEAD_ADDRESS,
            customFee,
            assetBuybackPercentWad,
            numeraireBuybackPercentWad,
            beneficiaryPercentWad: '0',
            lpPercentWad: '0',
          },
        },
      });
    },
    240_000,
  );

  liveIt(
    'MEDIUM Governance Enabled (Random 60-90% Sale)',
    ['multicurve', 'governance'],
    async () => {
      const randomSalePercent = 60 + Math.floor(Math.random() * 31);
      await runMulticurveLaunchAndVerify('medium', {
        configLabel: `MEDIUM Governance Enabled (${randomSalePercent}% Sale)`,
        salePercent: randomSalePercent,
        governance: true,
      });
    },
    240_000,
  );

  liveIt(
    'STATIC V3 Governance Enabled (Random Preset)',
    ['static', 'governance'],
    async () => {
      const presets: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
      const preset = presets[Math.floor(Math.random() * presets.length)]!;
      await runStaticLaunchAndVerify({
        configLabel: `STATIC V3 Governance Enabled (${preset.toUpperCase()} preset)`,
        governance: true,
        curveConfig: {
          type: 'preset',
          preset,
        },
      });
    },
    240_000,
  );

  liveIt(
    'DYNAMIC V4 Governance Enabled (Random Range/Proceeds)',
    ['dynamic', 'governance'],
    async () => {
      const marketCapStartUsd = 100 + Math.floor(Math.random() * 901); // 100-1000
      const minGapUsd = 20 + Math.floor(Math.random() * 181); // 20-200
      const marketCapMinUsd = Math.max(1, marketCapStartUsd - minGapUsd);
      const minProceedsEth = 0.01 + Math.random() * 0.04; // 0.01-0.05
      const maxMultiplier = 2 + Math.random() * 4; // 2x-6x
      const maxProceedsEth = minProceedsEth * maxMultiplier;
      const durationSeconds = (6 + Math.floor(Math.random() * 19)) * 60 * 60; // 6h-24h
      const epochLengthSeconds = 60 * 60; // 1h; guarantees duration % epochLength == 0

      await runDynamicLaunchAndVerify({
        configLabel: `DYNAMIC V4 Governance Enabled (start $${marketCapStartUsd}, min $${marketCapMinUsd}, proceeds ${minProceedsEth.toFixed(4)}-${maxProceedsEth.toFixed(4)}, ${durationSeconds}s, epoch ${epochLengthSeconds}s)`,
        governance: true,
        marketCapStartUsd,
        marketCapMinUsd,
        minProceeds: minProceedsEth.toFixed(4),
        maxProceeds: maxProceedsEth.toFixed(4),
        durationSeconds,
        epochLengthSeconds,
      });
    },
    240_000,
  );

  liveIt(
    'rejects unsupported migration modes as not implemented',
    ['negative'],
    async () => {
      const config = loadConfig();
      const services = buildServices(config);
      const chain = services.chainRegistry.get(config.defaultChainId);
      const userAddress = privateKeyToAccount(config.privateKey).address;

      const basePayload = {
        chainId: chain.chainId,
        userAddress,
        tokenMetadata: {
          name: `Live Planned ${Date.now()}`,
          symbol: `P${Date.now().toString().slice(-4)}`,
          tokenURI: 'ipfs://live-planned',
        },
        tokenomics: {
          totalSupply: (1_000_000n * 10n ** 18n).toString(),
        },
        auction: {
          type: 'multicurve' as const,
          curveConfig: {
            type: 'preset' as const,
            presets: ['low' as const],
          },
        },
        pricing: {
          numerairePriceUsd: Number(process.env.LIVE_NUMERAIRE_PRICE_USD || '3000'),
        },
      };

      if (liveVerbose) {
        // eslint-disable-next-line no-console
        console.log(liveDivider('Validating unsupported migration modes'));
        printLiveTable('Expected Responses', [
          ['migration uniswapV2/uniswapV3/uniswapV4', '501 MIGRATION_NOT_IMPLEMENTED'],
        ]);
      }

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV3' },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV2' },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );

      await assertNotImplementedError(
        services.launchService.createLaunch({
          ...basePayload,
          governance: { enabled: false, mode: 'noOp' },
          migration: { type: 'uniswapV4' },
        }),
        'MIGRATION_NOT_IMPLEMENTED',
      );
      verboseLog('[live] unsupported migration checks passed');
    },
    120_000,
  );
});
