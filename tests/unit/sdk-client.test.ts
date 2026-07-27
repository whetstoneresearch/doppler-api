import { airlockAbi } from '@whetstone-research/doppler-sdk/evm';
import { ContractFunctionRevertedError } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { translateCreateSimulationError } from '../../src/infra/doppler/sdk-client';

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
