import { airlockAbi, getAddresses, type CreateParams } from '@whetstone-research/doppler-sdk/evm';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ContractFunctionRevertedError,
  decodeAbiParameters,
  decodeFunctionData,
  zeroAddress,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { CreateAnyLaunchResponse } from '../../src/core/types';
import type { ChainContext, ChainRegistry } from '../../src/infra/chain/registry';
import { DopplerSdkRegistry } from '../../src/infra/doppler/sdk-client';
import type { IdempotencyStore } from '../../src/infra/idempotency/store';
import { TxSubmitter } from '../../src/infra/tx/submitter';
import { LaunchService } from '../../src/modules/launches/service';
import { createLaunchRequestSchema } from '../../src/modules/launches/schema';
import type { SolanaLaunchService } from '../../src/modules/launches/solana';
import type { PricingService } from '../../src/modules/pricing/service';
import { readOpenApiExample } from '../fixtures/openapi';
import {
  decodeDopplerHookMigratorData,
  decodeRehypeMigratorInitCalldata,
  decodeRehypeInitCalldata,
  decodeStandardTokenFactoryData,
} from '../live/helpers/calldata-decoders';
import { decodeDopplerHookInitializerData } from '../live/helpers/doppler-hook-calldata';

const CHAIN_ID = 84532 as const;
const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;
const OWNER = '0x9999999999999999999999999999999999999999';
const TOKEN = '0xf000000000000000000000000000000000000000';
const POOL = '0x2000000000000000000000000000000000000000';
const TIMELOCK = '0x3000000000000000000000000000000000000000';
const TX_HASH = `0x${'ab'.repeat(32)}` as const;
const createHarness = (createSimulationError?: Error) => {
  const addresses = getAddresses(CHAIN_ID);
  const account = privateKeyToAccount(PRIVATE_KEY);
  const simulatedRequests: Array<Record<string, unknown>> = [];
  const preparedRequests: Array<Record<string, unknown>> = [];

  const publicClient = {
    simulateContract: vi.fn(async (request: Record<string, unknown>) => {
      simulatedRequests.push(request);
      if (request.functionName === 'create' && createSimulationError) {
        throw createSimulationError;
      }
      return {
        request,
        result: [TOKEN, POOL, 0n, TIMELOCK],
      };
    }),
    getBytecode: vi.fn(async () => '0x6000' as const),
    estimateContractGas: vi.fn(async () => 1_000_000n),
    getBlock: vi.fn(async () => ({ timestamp: 1_900_000_000n })),
    getTransactionCount: vi.fn(async () => 7),
    readContract: vi.fn(async (request: { readonly functionName: string }) => {
      switch (request.functionName) {
        case 'owner':
          return OWNER;
        case 'HOOK':
          return addresses.dopplerHookInitializer;
        case 'poolManager':
          return addresses.poolManager;
        case 'dopplerDeployer':
          return addresses.dopplerDeployer;
        default:
          throw new Error(`Unexpected SDK read: ${request.functionName}`);
      }
    }),
  };
  const walletClient = {
    account,
    prepareTransactionRequest: vi.fn(async (request: Record<string, unknown>) => {
      preparedRequests.push(request);
      return request;
    }),
    signTransaction: vi.fn(async () => `0x${'12'.repeat(100)}` as const),
    sendRawTransaction: vi.fn(async () => TX_HASH),
  };
  const chain = {
    chainId: CHAIN_ID,
    config: {
      chainId: CHAIN_ID,
      rpcUrl: 'http://127.0.0.1:1',
      defaultNumeraireAddress: addresses.weth,
      auctionTypes: ['static', 'multicurve', 'dynamic'],
      migrationModes: ['noOp', 'uniswapV2', 'uniswapV4'],
      governanceModes: ['noOp', 'default', 'custom'],
      governanceEnabled: true,
    },
    addresses,
    publicClient,
    walletClient,
  } as unknown as ChainContext;
  const sdkRegistry = new DopplerSdkRegistry([chain]);
  vi.spyOn(sdkRegistry.get(CHAIN_ID), 'getAirlockOwner').mockResolvedValue(OWNER);
  const idempotencyRecords = new Map<string, CreateAnyLaunchResponse>();
  const idempotencyStore: IdempotencyStore = {
    execute: async (
      key: string,
      _payload: unknown,
      action: () => Promise<CreateAnyLaunchResponse>,
    ) => {
      const existing = idempotencyRecords.get(key);
      if (existing) {
        return { response: existing, replayed: true };
      }
      const response = await action();
      idempotencyRecords.set(key, response);
      return { response, replayed: false };
    },
  };
  const txSubmitter = new TxSubmitter();
  const launchService = new LaunchService({
    chainRegistry: { get: () => chain } as unknown as ChainRegistry,
    sdkRegistry,
    pricingService: {
      resolveNumerairePriceUsd: async () => 3_000,
    } as unknown as PricingService,
    txSubmitter,
    idempotencyStore,
    requireIdempotencyKey: false,
    solanaLaunchService: {} as unknown as SolanaLaunchService,
  });
  return {
    addresses,
    launchService,
    preparedRequests,
    simulatedRequests,
  };
};

const getSubmittedCreateParams = (
  preparedRequests: readonly Record<string, unknown>[],
): CreateParams => {
  const request = preparedRequests.at(-1);
  if (!request || typeof request.data !== 'string') {
    throw new Error('Production launch path did not submit Airlock.create');
  }

  const decoded = decodeFunctionData({
    abi: airlockAbi,
    data: request.data as `0x${string}`,
  });
  if (decoded.functionName !== 'create') {
    throw new Error('Production launch path did not submit Airlock.create');
  }

  const args = decoded.args as readonly [CreateParams] | undefined;
  if (!args?.[0]) {
    throw new Error('Airlock.create submission did not include create params');
  }
  return args[0];
};

describe('OpenAPI examples through production SDK assembly', () => {
  it.each([
    ['StaticPresetCreateLaunchExample', 'static'],
    ['MulticurveBuybackCreateLaunchExample', 'multicurveBuyback'],
    ['MulticurveBeneficiaryRoutingCreateLaunchExample', 'multicurveBeneficiaries'],
    ['DynamicUniswapV2CreateLaunchExample', 'uniswapV2'],
    ['DynamicUniswapV4CreateLaunchExample', 'uniswapV4'],
    ['DynamicRehypeUniswapV4CreateLaunchExample', 'rehypeUniswapV4'],
  ] as const)('assembles and submits %s', async (exampleName, expectedMode) => {
    const harness = createHarness();
    const input = createLaunchRequestSchema.parse(readOpenApiExample(exampleName));

    const response = await harness.launchService.createLaunch(input);
    const createParams = getSubmittedCreateParams(harness.preparedRequests);
    const decodedToken = decodeStandardTokenFactoryData(createParams.tokenFactoryData);

    expect(response.txHash).toBe(TX_HASH);
    expect(createParams.tokenFactory).toBe(harness.addresses.dopplerERC20V1Factory);
    expect(decodedToken.kind).toBe('dopplerERC20V1');

    if (expectedMode === 'static') {
      expect(createParams.poolInitializer).toBe(harness.addresses.lockableV3Initializer);
      expect(createParams.liquidityMigrator).toBe(harness.addresses.noOpMigrator);
    } else if (expectedMode === 'multicurveBuyback' || expectedMode === 'multicurveBeneficiaries') {
      expect(createParams.poolInitializer).toBe(harness.addresses.dopplerHookInitializer);
      expect(createParams.liquidityMigrator).toBe(harness.addresses.noOpMigrator);
      const decodedPool = decodeDopplerHookInitializerData(createParams.poolInitializerData);
      const decodedRehype = decodeRehypeInitCalldata(
        decodedPool.onInitializationDopplerHookCalldata,
      );

      if (expectedMode === 'multicurveBuyback') {
        expect(decodedToken.kind === 'dopplerERC20V1' && decodedToken.scheduleIds).toEqual([
          0n,
          1n,
        ]);
        expect(decodedRehype.buybackDst).toBe('0x2222222222222222222222222222222222222222');
        expect(decodedRehype.feeRoutingMode).toBe(0);
        expect(decodedRehype.feeBeneficiaries).toEqual([]);
      } else {
        expect(decodedPool.beneficiaries).toContainEqual({
          beneficiary: OWNER,
          shares: 50_000_000_000_000_000n,
        });
        expect(
          decodedPool.beneficiaries.reduce((total, beneficiary) => total + beneficiary.shares, 0n),
        ).toBe(1_000_000_000_000_000_000n);
        expect(decodedRehype.buybackDst).toBe(zeroAddress);
        expect(decodedRehype.feeRoutingMode).toBe(1);
        expect(decodedRehype.feeBeneficiaries).toEqual([
          {
            beneficiary: '0x3333333333333333333333333333333333333333',
            shares: 200_000_000_000_000_000n,
          },
          {
            beneficiary: '0x4444444444444444444444444444444444444444',
            shares: 300_000_000_000_000_000n,
          },
          {
            beneficiary: '0x5555555555555555555555555555555555555555',
            shares: 500_000_000_000_000_000n,
          },
        ]);
        expect(
          decodedRehype.feeBeneficiaries.some(
            (beneficiary) => beneficiary.beneficiary.toLowerCase() === OWNER.toLowerCase(),
          ),
        ).toBe(false);
      }
    } else if (expectedMode === 'uniswapV2') {
      expect(createParams.poolInitializer).toBe(harness.addresses.v4Initializer);
      expect(createParams.liquidityMigrator).toBe(harness.addresses.v2MigratorSplit);
      expect(
        decodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          createParams.liquidityMigratorData,
        ),
      ).toEqual(['0x2222222222222222222222222222222222222222', 250000000000000000n]);
    } else if (expectedMode === 'uniswapV4') {
      expect(createParams.poolInitializer).toBe(harness.addresses.v4Initializer);
      expect(createParams.liquidityMigrator).toBe(harness.addresses.dopplerHookMigrator);
      const decodedMigration = decodeDopplerHookMigratorData(createParams.liquidityMigratorData);
      expect(decodedMigration.useDynamicFee).toBe(false);
      expect(decodedMigration.dopplerHook).toBe(zeroAddress);
      expect(decodedMigration.onInitializationCalldata).toBe('0x');
    } else {
      expect(createParams.poolInitializer).toBe(harness.addresses.v4Initializer);
      expect(createParams.liquidityMigrator).toBe(harness.addresses.dopplerHookMigrator);
      const decodedMigration = decodeDopplerHookMigratorData(createParams.liquidityMigratorData);
      expect(decodedMigration.useDynamicFee).toBe(false);
      expect(decodedMigration.dopplerHook).toBe(harness.addresses.rehypeDopplerHookMigrator);
      expect(decodedMigration.proceedsRecipient).toBe(zeroAddress);
      expect(decodedMigration.proceedsShare).toBe(0n);
      expect(decodeRehypeMigratorInitCalldata(decodedMigration.onInitializationCalldata)).toEqual({
        numeraire: harness.addresses.weth,
        buybackDst: '0x2222222222222222222222222222222222222222',
        customFee: 10_000,
        feeRoutingMode: 1,
        feeDistributionInfo: {
          assetFeesToAssetBuybackWad: 500_000_000_000_000_000n,
          assetFeesToNumeraireBuybackWad: 500_000_000_000_000_000n,
          assetFeesToBeneficiaryWad: 0n,
          assetFeesToLpWad: 0n,
          numeraireFeesToAssetBuybackWad: 0n,
          numeraireFeesToNumeraireBuybackWad: 250_000_000_000_000_000n,
          numeraireFeesToBeneficiaryWad: 250_000_000_000_000_000n,
          numeraireFeesToLpWad: 500_000_000_000_000_000n,
        },
      });
    }
  });

  it('translates a confirmed SDK-generated token address collision', async () => {
    const deploymentFailed = new ContractFunctionRevertedError({
      abi: airlockAbi,
      data: '0x30116425',
      functionName: 'create',
    });
    const harness = createHarness(deploymentFailed);
    const input = createLaunchRequestSchema.parse(
      readOpenApiExample('MulticurveBuybackCreateLaunchExample'),
    );

    await expect(harness.launchService.createLaunch(input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TOKEN_ADDRESS_COLLISION',
      message:
        'The SDK-generated salt maps to an existing token address; retry the launch to generate a different salt',
      details: {
        chainId: CHAIN_ID,
      },
    });
    expect(harness.preparedRequests).toEqual([]);
  });

  it('replays a balance-limited launch after its end timestamp passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_900_000_000_000);
    try {
      const harness = createHarness();
      const documented = createLaunchRequestSchema.parse(
        readOpenApiExample('StaticPresetCreateLaunchExample'),
      );
      const raw = {
        ...documented,
        tokenMetadata: {
          ...(documented.tokenMetadata as object),
          maxBalanceLimit: '1',
          balanceLimitEnd: 1_900_000_002,
        },
      };
      const first = await harness.launchService.createLaunchWithIdempotency({
        input: createLaunchRequestSchema.parse(raw),
        idempotencyKey: 'expiring-balance-limit',
      });

      vi.setSystemTime(1_900_000_003_000);
      const replay = await harness.launchService.createLaunchWithIdempotency({
        input: createLaunchRequestSchema.parse(raw),
        idempotencyKey: 'expiring-balance-limit',
      });

      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(replay.response).toEqual(first.response);
      expect(harness.preparedRequests).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an expired balance limit for a new launch before SDK assembly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_900_000_003_000);
    try {
      const harness = createHarness();
      const documented = createLaunchRequestSchema.parse(
        readOpenApiExample('StaticPresetCreateLaunchExample'),
      );
      const input = createLaunchRequestSchema.parse({
        ...documented,
        tokenMetadata: {
          ...(documented.tokenMetadata as object),
          maxBalanceLimit: '1',
          balanceLimitEnd: 1_900_000_002,
        },
      });

      await expect(
        harness.launchService.createLaunchWithIdempotency({
          input,
          idempotencyKey: 'expired-balance-limit',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_TOKEN_CONFIG',
        statusCode: 422,
      });
      expect(harness.preparedRequests).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
