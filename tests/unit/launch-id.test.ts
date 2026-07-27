import { getAddresses } from '@whetstone-research/doppler-sdk/evm';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import type { ChainContext, ChainRegistry } from '../../src/infra/chain/registry';
import type { DopplerSdkRegistry } from '../../src/infra/doppler/sdk-client';
import {
  buildLaunchId,
  parseLaunchId,
  poolOrHookAddressToPoolId,
} from '../../src/modules/launches/mapper';
import { StatusService } from '../../src/modules/status/service';

describe('launchId mapping', () => {
  it('builds and parses launchId', () => {
    const launchId = buildLaunchId(
      84532,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(launchId).toBe(
      '84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    const parsed = parseLaunchId(launchId);
    expect(parsed.chainId).toBe(84532);
    expect(parsed.txHash).toBe(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('throws on invalid launchId', () => {
    expect(() => parseLaunchId('abc')).toThrow();
  });

  it('derives deterministic poolId from pool or hook address', () => {
    expect(poolOrHookAddressToPoolId('0x1111111111111111111111111111111111111111')).toBe(
      '0x0000000000000000000000001111111111111111111111111111111111111111',
    );
  });

  it('derives canonical standard and Rehype pool-key fields from DopplerHookInitializer data', async () => {
    const addresses = getAddresses(84532);
    if (!addresses.dopplerHookInitializer || !addresses.rehypeDopplerHookInitializer) {
      throw new Error('Rehype initializer addresses are required for the fixture');
    }
    const hookAddress = '0x2222222222222222222222222222222222222222';
    const chainDefinition = defineChain({
      id: 84532,
      name: 'status-test',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['http://127.0.0.1:1'] } },
    });
    const account = privateKeyToAccount(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    const encodePoolInitializerData = (dopplerHook: `0x${string}`) =>
      encodeAbiParameters(
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
            dopplerHook,
            onInitializationDopplerHookCalldata: '0x',
            graduationDopplerHookCalldata: '0x',
          },
        ],
      );
    const chain = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'http://127.0.0.1:1',
        defaultNumeraireAddress: addresses.weth,
        auctionTypes: ['multicurve'],
        migrationModes: ['noOp'],
        governanceModes: ['noOp', 'default'],
        governanceEnabled: true,
      },
      addresses,
      publicClient: createPublicClient({ chain: chainDefinition, transport: http() }),
      walletClient: createWalletClient({ account, chain: chainDefinition, transport: http() }),
    } satisfies ChainContext;
    const service = new StatusService({
      chainRegistry: {} as ChainRegistry,
      sdkRegistry: {} as DopplerSdkRegistry,
    });

    const standard = await service.decodePoolConfigFromInitializerData({
      chain,
      poolInitializer: addresses.dopplerHookInitializer,
      poolInitializerData: encodePoolInitializerData(zeroAddress),
    });
    const rehype = await service.decodePoolConfigFromInitializerData({
      chain,
      poolInitializer: addresses.dopplerHookInitializer,
      poolInitializerData: encodePoolInitializerData(hookAddress),
    });

    expect(standard).toEqual({
      fee: 10_000,
      tickSpacing: 200,
      hookAddress: addresses.dopplerHookInitializer,
    });
    expect(rehype).toEqual({
      fee: 8_388_608,
      tickSpacing: 200,
      hookAddress: addresses.dopplerHookInitializer,
    });
  });
});
