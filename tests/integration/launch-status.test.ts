import {
  DYNAMIC_FEE_FLAG,
  airlockAbi,
  computePoolId,
  getAddresses,
} from '@whetstone-research/doppler-sdk/evm';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroAddress } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChainContext, ChainRegistry } from '../../src/infra/chain/registry';
import type { DopplerSdkRegistry } from '../../src/infra/doppler/sdk-client';
import { StatusService } from '../../src/modules/status/service';
import { buildTestServer } from './test-server';

describe('GET /v1/launches/:launchId', () => {
  let app: Awaited<ReturnType<typeof buildTestServer>> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns launch status', async () => {
    app = await buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headers: {
        'x-api-key': 'test-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('pending');
  });

  it('assembles confirmed Rehype status from receipt event and exact create calldata', async () => {
    const addresses = getAddresses(84532);
    const txHash = `0x${'a'.repeat(64)}` as const;
    const asset = '0x1111111111111111111111111111111111111111' as const;
    const {
      weth: numeraire,
      dopplerERC20V1Factory: tokenFactory,
      noOpGovernanceFactory: governanceFactory,
      dopplerHookInitializer: poolOrHook,
      rehypeDopplerHookInitializer: rehypeHook,
      noOpMigrator: liquidityMigrator,
    } = addresses;
    if (
      !numeraire ||
      !tokenFactory ||
      !governanceFactory ||
      !poolOrHook ||
      !rehypeHook ||
      !liquidityMigrator
    ) {
      throw new Error('Base Sepolia canonical status fixtures are incomplete');
    }
    const poolInitializerData = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'farTick', type: 'int24' },
            {
              name: 'curves',
              type: 'tuple[]',
              components: [
                { name: 'tickLower', type: 'int24' },
                { name: 'tickUpper', type: 'int24' },
                { name: 'numPositions', type: 'uint16' },
                { name: 'shares', type: 'uint256' },
              ],
            },
            {
              name: 'beneficiaries',
              type: 'tuple[]',
              components: [
                { name: 'beneficiary', type: 'address' },
                { name: 'shares', type: 'uint96' },
              ],
            },
            { name: 'dopplerHook', type: 'address' },
            { name: 'onInitializationDopplerHookCalldata', type: 'bytes' },
            { name: 'graduationDopplerHookCalldata', type: 'bytes' },
          ],
        },
      ],
      [
        {
          fee: 10_000,
          tickSpacing: 200,
          farTick: 100_000,
          curves: [],
          beneficiaries: [],
          dopplerHook: rehypeHook,
          onInitializationDopplerHookCalldata: '0x',
          graduationDopplerHookCalldata: '0x',
        },
      ],
    );
    const transactionInput = encodeFunctionData({
      abi: airlockAbi,
      functionName: 'create',
      args: [
        {
          initialSupply: 1n,
          numTokensToSell: 1n,
          numeraire,
          tokenFactory,
          tokenFactoryData: '0x',
          governanceFactory,
          governanceFactoryData: '0x',
          poolInitializer: poolOrHook,
          poolInitializerData,
          liquidityMigrator,
          liquidityMigratorData: '0x',
          integrator: asset,
          salt: `0x${'b'.repeat(64)}`,
        },
      ],
    });
    const topics = encodeEventTopics({
      abi: airlockAbi,
      eventName: 'Create',
      args: { numeraire },
    });
    const data = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
      [asset, poolOrHook, poolOrHook],
    );
    const publicClient = {
      getTransactionReceipt: vi.fn(async () => ({
        status: 'success',
        blockNumber: 100n,
        logs: [{ data, topics }],
      })),
      getBlockNumber: vi.fn(async () => 102n),
      getTransaction: vi.fn(async () => ({ input: transactionInput })),
      readContract: vi.fn(),
    };
    const chain = {
      chainId: 84532,
      addresses,
      publicClient,
      walletClient: {},
    } as unknown as ChainContext;
    const service = new StatusService({
      chainRegistry: { get: () => chain } as unknown as ChainRegistry,
      sdkRegistry: {} as DopplerSdkRegistry,
    });
    const [currency0, currency1]: readonly [`0x${string}`, `0x${string}`] =
      asset.toLowerCase() < numeraire.toLowerCase() ? [asset, numeraire] : [numeraire, asset];

    const status = await service.getLaunchStatus(`84532:${txHash}`);

    expect(status).toEqual({
      launchId: `84532:${txHash}`,
      chainId: 84532,
      txHash,
      status: 'confirmed',
      confirmations: 3,
      result: {
        tokenAddress: asset,
        poolOrHookAddress: poolOrHook,
        poolId: computePoolId({
          currency0,
          currency1,
          fee: DYNAMIC_FEE_FLAG,
          tickSpacing: 200,
          hooks: poolOrHook,
        }),
        blockNumber: '100',
      },
    });
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(liquidityMigrator).not.toBe(zeroAddress);
  });
});
