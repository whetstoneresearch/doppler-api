import { airlockAbi, computePoolId } from '@whetstone-research/doppler-sdk';
import { TransactionNotFoundError, decodeAbiParameters, decodeFunctionData } from 'viem';

import { AppError } from '../../core/errors';
import type { LaunchStatusResponse } from '../../core/types';
import type { ChainRegistry } from '../../infra/chain/registry';
import type { DopplerSdkRegistry } from '../../infra/doppler/sdk-client';
import { decodeCreateEvent, type DecodedCreateEvent } from '../../infra/chain/receipt-decoder';
import { parseLaunchId } from '../launches/mapper';

interface StatusServiceDeps {
  chainRegistry: ChainRegistry;
  sdkRegistry: DopplerSdkRegistry;
}

export class StatusService {
  private readonly chainRegistry: ChainRegistry;
  private readonly sdkRegistry: DopplerSdkRegistry;

  constructor(deps: StatusServiceDeps) {
    this.chainRegistry = deps.chainRegistry;
    this.sdkRegistry = deps.sdkRegistry;
  }

  private async getTransactionWithRetry(args: {
    chainId: number;
    txHash: `0x${string}`;
    maxAttempts?: number;
    delayMs?: number;
  }) {
    const chain = this.chainRegistry.get(args.chainId);
    const maxAttempts = args.maxAttempts ?? 12;
    const delayMs = args.delayMs ?? 1500;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await chain.publicClient.getTransaction({ hash: args.txHash });
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new AppError(
      502,
      'CHAIN_LOOKUP_FAILED',
      `Transaction ${args.txHash} was not available after ${maxAttempts} attempts`,
      lastError,
    );
  }

  private async resolvePoolIdFromCreateTx(args: {
    chainId: number;
    txHash: `0x${string}`;
    created: DecodedCreateEvent;
  }): Promise<`0x${string}`> {
    const tx = await this.getTransactionWithRetry({
      chainId: args.chainId,
      txHash: args.txHash,
    });
    const decoded = decodeFunctionData({
      abi: airlockAbi,
      data: tx.input,
    });

    if (decoded.functionName !== 'create') {
      throw new AppError(
        502,
        'CREATE_TX_DECODE_FAILED',
        'Transaction is not an Airlock create() call',
      );
    }

    const createArgs = (decoded.args ?? []) as readonly unknown[];
    const createArg = createArgs[0] as {
      numeraire: `0x${string}`;
      poolInitializerData: `0x${string}`;
    };

    const [poolConfig] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
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
          ],
        },
      ],
      createArg.poolInitializerData,
    ) as readonly [{ fee: number; tickSpacing: number }];

    const token = args.created.tokenAddress.toLowerCase() as `0x${string}`;
    const numeraire = createArg.numeraire.toLowerCase() as `0x${string}`;
    const [currency0, currency1] = token < numeraire ? [token, numeraire] : [numeraire, token];

    return computePoolId({
      currency0,
      currency1,
      fee: poolConfig.fee,
      tickSpacing: poolConfig.tickSpacing,
      hooks: args.created.poolOrHookAddress,
    }) as `0x${string}`;
  }

  async getLaunchStatus(launchId: string): Promise<LaunchStatusResponse> {
    let parsed: { chainId: number; txHash: `0x${string}` };
    try {
      parsed = parseLaunchId(launchId);
    } catch {
      throw new AppError(422, 'INVALID_LAUNCH_ID', 'launchId must be <chainId>:<txHash>');
    }

    const chain = this.chainRegistry.get(parsed.chainId);

    let receipt: Awaited<ReturnType<typeof chain.publicClient.getTransactionReceipt>>;
    try {
      receipt = await chain.publicClient.getTransactionReceipt({ hash: parsed.txHash });
    } catch (error) {
      if (error instanceof TransactionNotFoundError) {
        try {
          await this.getTransactionWithRetry({
            chainId: parsed.chainId,
            txHash: parsed.txHash,
            maxAttempts: 2,
            delayMs: 250,
          });
          return {
            launchId,
            chainId: parsed.chainId,
            txHash: parsed.txHash,
            status: 'pending',
            confirmations: 0,
          };
        } catch {
          return {
            launchId,
            chainId: parsed.chainId,
            txHash: parsed.txHash,
            status: 'not_found',
            confirmations: 0,
          };
        }
      }
      throw new AppError(502, 'CHAIN_LOOKUP_FAILED', 'Failed to fetch transaction receipt', error);
    }

    const latestBlock = await chain.publicClient.getBlockNumber();
    const confirmations = Number(latestBlock - receipt.blockNumber + 1n);

    if (receipt.status === 'reverted') {
      return {
        launchId,
        chainId: parsed.chainId,
        txHash: parsed.txHash,
        status: 'reverted',
        confirmations,
        error: {
          code: 'TX_REVERTED',
          message: 'Transaction reverted on-chain',
        },
      };
    }

    const created = decodeCreateEvent(receipt.logs);
    if (!created) {
      throw new AppError(
        502,
        'CREATE_EVENT_NOT_FOUND',
        'Transaction confirmed but Create event was not found',
      );
    }

    const poolId = await this.resolvePoolIdFromCreateTx({
      chainId: parsed.chainId,
      txHash: parsed.txHash,
      created,
    });

    return {
      launchId,
      chainId: parsed.chainId,
      txHash: parsed.txHash,
      status: 'confirmed',
      confirmations,
      result: {
        tokenAddress: created.tokenAddress,
        poolOrHookAddress: created.poolOrHookAddress,
        poolId,
        blockNumber: receipt.blockNumber.toString(),
      },
    };
  }
}
