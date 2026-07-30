import { airlockAbi, getAddresses } from '@whetstone-research/doppler-sdk/evm';
import { ContractFunctionRevertedError } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { ChainContext } from '../../src/infra/chain/registry';
import {
  DopplerSdkRegistry,
  translateCreateSimulationError,
  withCreateSimulationErrorTranslation,
} from '../../src/infra/doppler/sdk-client';

const TOKEN_FACTORY = '0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292';
const TOKEN_IMPLEMENTATION = '0xDB7B520bb5C3a2C5d4871198081911359f93be87';
const SALT = `0x${'00'.repeat(31)}01`;
const PREDICTED_TOKEN = '0x082fd311890fFDff2b31c9E9Eb8969230Aaa127D';
const createRequest = {
  functionName: 'create',
  args: [{ salt: SALT, tokenFactory: TOKEN_FACTORY }],
};

const deploymentFailed = new ContractFunctionRevertedError({
  abi: airlockAbi,
  data: '0x30116425',
  functionName: 'create',
});

describe('Doppler SDK client collision translation', () => {
  it('returns a clear conflict only when the failed salt address already has code', async () => {
    const getBytecode = vi.fn(async () => '0x6000' as const);

    await expect(
      translateCreateSimulationError({
        error: deploymentFailed,
        request: createRequest,
        chainId: 84532,
        tokenImplementation: TOKEN_IMPLEMENTATION,
        getBytecode,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'TOKEN_ADDRESS_COLLISION',
      message:
        'The SDK-generated salt maps to an existing token address; retry the launch to generate a different salt',
      details: {
        chainId: 84532,
        salt: SALT,
      },
    });
    expect(getBytecode).toHaveBeenCalledExactlyOnceWith(PREDICTED_TOKEN);
  });

  it('recognizes wrapped provider failures with non-string data', async () => {
    const wrapped = Object.assign(
      new Error(`simulation reverted with ${deploymentFailed.signature}`),
      {
        data: { error: deploymentFailed },
        cause: deploymentFailed,
      },
    );

    await expect(
      translateCreateSimulationError({
        error: wrapped,
        request: createRequest,
        chainId: 84532,
        tokenImplementation: TOKEN_IMPLEMENTATION,
        getBytecode: async () => '0x6000',
      }),
    ).rejects.toMatchObject({
      code: 'TOKEN_ADDRESS_COLLISION',
      statusCode: 409,
    });
  });

  it('translates failures from a caller-provided create simulation', async () => {
    const getBytecode = vi.fn(async () => '0x6000' as const);
    const simulate = vi.fn(async () => {
      throw deploymentFailed;
    });

    await expect(
      withCreateSimulationErrorTranslation(
        {
          chainId: 84532,
          addresses: {
            ...getAddresses(84532),
            dopplerERC20V1Implementation: TOKEN_IMPLEMENTATION,
          },
          publicClient: { getBytecode },
        },
        createRequest,
        simulate,
      ),
    ).rejects.toMatchObject({
      code: 'TOKEN_ADDRESS_COLLISION',
      statusCode: 409,
    });
    expect(simulate).toHaveBeenCalledOnce();
    expect(getBytecode).toHaveBeenCalledExactlyOnceWith({
      address: PREDICTED_TOKEN,
      blockTag: 'pending',
    });
  });

  it('uses pending state for SDK bytecode lookups without an explicit block', async () => {
    const getBytecode = vi.fn(async () => undefined);
    const context: ChainContext = {
      chainId: 84532,
      config: {
        chainId: 84532,
        rpcUrl: 'https://rpc.example',
        auctionTypes: ['dynamic'],
        migrationModes: ['noOp'],
        governanceModes: ['noOp'],
        governanceEnabled: false,
      },
      publicClient: { getBytecode } as unknown as ChainContext['publicClient'],
      walletClient: {} as ChainContext['walletClient'],
      addresses: getAddresses(84532),
    };
    const registry = new DopplerSdkRegistry([context]);
    const publicClient = registry.get(84532).getClients()
      .publicClient as ChainContext['publicClient'];

    await publicClient.getBytecode({
      address: TOKEN_FACTORY,
    });

    expect(getBytecode).toHaveBeenCalledExactlyOnceWith({
      address: TOKEN_FACTORY,
      blockTag: 'pending',
    });
  });

  it('preserves DeploymentFailed when the predicted address has no code', async () => {
    const getBytecode = vi.fn(async () => undefined);

    await expect(
      translateCreateSimulationError({
        error: deploymentFailed,
        request: createRequest,
        chainId: 84532,
        tokenImplementation: TOKEN_IMPLEMENTATION,
        getBytecode,
      }),
    ).rejects.toBe(deploymentFailed);
  });

  it('does not classify unrelated simulation failures as collisions', async () => {
    const unrelated = new Error('rpc unavailable');
    const getBytecode = vi.fn(async () => '0x6000' as const);

    await expect(
      translateCreateSimulationError({
        error: unrelated,
        request: createRequest,
        chainId: 84532,
        tokenImplementation: TOKEN_IMPLEMENTATION,
        getBytecode,
      }),
    ).rejects.toBe(unrelated);
    expect(getBytecode).not.toHaveBeenCalled();
  });
});
