import { DopplerSDK } from '@whetstone-research/doppler-sdk/evm';
import {
  BaseError,
  ContractFunctionRevertedError,
  getCreate2Address,
  keccak256,
  type Hex,
} from 'viem';
import { z } from 'zod';

import { AppError } from '../../core/errors';
import type { ChainContext } from '../chain/registry';

const DEPLOYMENT_FAILED_SELECTOR = '0x30116425';
const SOLADY_CLONE_PREFIX = '0x602c3d8160093d39f33d3d3d3d363d3d37363d73';
const SOLADY_CLONE_SUFFIX = '5af43d3d93803e602a57fd5bf3';

const createSimulationSchema = z
  .object({
    functionName: z.literal('create'),
    args: z.tuple([
      z
        .object({
          salt: z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/)
            .transform((value): Hex => `0x${value.slice(2)}`),
          tokenFactory: z
            .string()
            .regex(/^0x[a-fA-F0-9]{40}$/)
            .transform((value): `0x${string}` => `0x${value.slice(2)}`),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const isDeploymentFailed = (error: unknown): boolean => {
  if (!(error instanceof BaseError)) {
    return false;
  }

  return (
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError &&
        cause.raw?.slice(0, 10).toLowerCase() === DEPLOYMENT_FAILED_SELECTOR,
    ) !== null
  );
};

export const translateCreateSimulationError = async (args: {
  error: unknown;
  request: unknown;
  chainId: number;
  tokenImplementation: `0x${string}` | undefined;
  getBytecode: (address: `0x${string}`) => Promise<Hex | undefined>;
}): Promise<never> => {
  const request = createSimulationSchema.safeParse(args.request);
  if (!isDeploymentFailed(args.error) || !request.success || !args.tokenImplementation) {
    throw args.error;
  }

  const [{ salt, tokenFactory }] = request.data.args;
  const initCodeHash = keccak256(
    `${SOLADY_CLONE_PREFIX}${args.tokenImplementation.slice(2)}${SOLADY_CLONE_SUFFIX}`,
  );
  const tokenAddress = getCreate2Address({
    from: tokenFactory,
    salt,
    bytecodeHash: initCodeHash,
  });

  let bytecode: Hex | undefined;
  try {
    bytecode = await args.getBytecode(tokenAddress);
  } catch {
    throw args.error;
  }
  if (!bytecode || bytecode === '0x') {
    throw args.error;
  }

  throw new AppError(
    409,
    'TOKEN_ADDRESS_COLLISION',
    'The SDK-generated salt maps to an existing token address; retry the launch to generate a different salt',
    {
      chainId: args.chainId,
      salt,
      tokenAddress,
    },
  );
};

const createCollisionAwarePublicClient = (context: ChainContext): ChainContext['publicClient'] =>
  new Proxy(context.publicClient, {
    get(target, property, receiver) {
      if (property !== 'simulateContract') {
        return Reflect.get(target, property, receiver);
      }

      return async (request: Parameters<ChainContext['publicClient']['simulateContract']>[0]) => {
        try {
          return await target.simulateContract(request);
        } catch (error) {
          return translateCreateSimulationError({
            error,
            request,
            chainId: context.chainId,
            tokenImplementation: context.addresses.dopplerERC20V1Implementation,
            getBytecode: async (address) => target.getBytecode({ address }),
          });
        }
      };
    },
  });

export class DopplerSdkRegistry {
  private readonly sdkByChain = new Map<number, DopplerSDK>();

  constructor(contexts: ChainContext[]) {
    for (const context of contexts) {
      this.sdkByChain.set(
        context.chainId,
        new DopplerSDK({
          publicClient: createCollisionAwarePublicClient(context),
          walletClient: context.walletClient,
          chainId: context.chainId,
        }),
      );
    }
  }

  get(chainId: number): DopplerSDK {
    const sdk = this.sdkByChain.get(chainId);
    if (!sdk) {
      throw new Error(`No Doppler SDK instance configured for chain ${chainId}`);
    }
    return sdk;
  }
}
