import { randomUUID } from 'node:crypto';

import {
  concatHex,
  encodeFunctionData,
  HttpRequestError,
  isAddress,
  isHex,
  NonceTooLowError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
} from 'viem';

import { AppError } from '../../core/errors';
import type { HexHash } from '../../core/types';
import type { ChainContext } from '../chain/registry';

const DEFAULT_NONCE_LOCK_TTL_MS = 120_000;
const DEFAULT_NONCE_LOCK_REFRESH_MS = 30_000;
const DEFAULT_NONCE_LOCK_POLL_INTERVAL_MS = 50;

const RELEASE_NONCE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const REFRESH_NONCE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isLockScriptSuccess = (result: unknown): boolean => result === 1 || result === '1';

const buildTransactionRequest = (request: Record<string, unknown>): Record<string, unknown> => {
  const { abi, address, args, dataSuffix, functionName, ...transactionRequest } = request;
  delete transactionRequest.account;
  delete transactionRequest.chain;

  if (
    !Array.isArray(abi) ||
    typeof functionName !== 'string' ||
    typeof address !== 'string' ||
    !isAddress(address) ||
    (args !== undefined && !Array.isArray(args)) ||
    (dataSuffix !== undefined && !isHex(dataSuffix))
  ) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Invalid contract transaction request');
  }

  const calldata = encodeFunctionData({
    abi,
    functionName,
    ...(args === undefined ? {} : { args }),
  });

  return {
    ...transactionRequest,
    data: dataSuffix === undefined ? calldata : concatHex([calldata, dataSuffix]),
    to: address,
  };
};

const AMBIGUOUS_BROADCAST_MESSAGE =
  /already known|transaction already imported|nonce too low|replacement transaction underpriced|request timed out|timed out after broadcast|socket hang up|socket (?:has been )?closed|connection reset|econnreset/i;

const isAmbiguousBroadcastError = (error: unknown): boolean => {
  const seen = new Set<object>();
  let current = error;

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof HttpRequestError) {
      return current.status === undefined || current.status === 408 || current.status >= 500;
    }

    if (
      current instanceof WebSocketRequestError ||
      current instanceof SocketClosedError ||
      current instanceof TimeoutError ||
      current instanceof NonceTooLowError
    ) {
      return true;
    }

    if (
      'message' in current &&
      typeof current.message === 'string' &&
      AMBIGUOUS_BROADCAST_MESSAGE.test(current.message)
    ) {
      return true;
    }

    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
};

export interface TxSubmitterRedisClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    durationMs: number,
    setMode?: 'NX',
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export class TxSubmitter {
  private readonly queueByChain = new Map<number, Promise<unknown>>();
  private readonly redis?: TxSubmitterRedisClient;
  private readonly redisKeyPrefix: string;
  private readonly lockTtlMs: number;
  private readonly lockRefreshMs: number;
  private readonly lockPollIntervalMs: number;

  constructor(args?: {
    redis?: TxSubmitterRedisClient;
    redisKeyPrefix?: string;
    lockTtlMs?: number;
    lockRefreshMs?: number;
    lockPollIntervalMs?: number;
  }) {
    this.redis = args?.redis;
    this.redisKeyPrefix = args?.redisKeyPrefix ?? 'doppler-api';
    this.lockTtlMs = args?.lockTtlMs ?? DEFAULT_NONCE_LOCK_TTL_MS;
    this.lockRefreshMs =
      args?.lockRefreshMs ??
      Math.min(DEFAULT_NONCE_LOCK_REFRESH_MS, Math.floor(this.lockTtlMs / 3));
    this.lockPollIntervalMs = args?.lockPollIntervalMs ?? DEFAULT_NONCE_LOCK_POLL_INTERVAL_MS;
  }

  private async withChainLock<T>(chainId: number, fn: () => Promise<T>): Promise<T> {
    const previous = this.queueByChain.get(chainId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queueByChain.set(
      chainId,
      previous.then(() => current),
    );

    await previous;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }

  private nonceLockKey(chainId: number, address: `0x${string}`): string {
    return `${this.redisKeyPrefix}:tx:nonce-lock:${chainId}:${address.toLowerCase()}`;
  }

  private async releaseNonceLock(lockKey: string, lockValue: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    await this.redis.eval(RELEASE_NONCE_LOCK_SCRIPT, 1, lockKey, lockValue);
  }

  private async refreshNonceLock(lockKey: string, lockValue: string): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    const result = await this.redis.eval(
      REFRESH_NONCE_LOCK_SCRIPT,
      1,
      lockKey,
      lockValue,
      this.lockTtlMs,
    );
    return isLockScriptSuccess(result);
  }

  private async withDistributedNonceLock<T>(args: {
    chainId: number;
    address: `0x${string}`;
    fn: (verifyLockOwnership: () => Promise<boolean>) => Promise<T>;
  }): Promise<T> {
    if (!this.redis) {
      return args.fn(async () => true);
    }

    const lockKey = this.nonceLockKey(args.chainId, args.address);
    const lockValue = randomUUID();

    for (;;) {
      const acquired =
        (await this.redis.set(lockKey, lockValue, 'PX', this.lockTtlMs, 'NX')) === 'OK';
      if (acquired) {
        break;
      }

      await delay(this.lockPollIntervalMs);
    }

    let heartbeatTimer: NodeJS.Timeout | undefined;
    let lockHealthy = true;
    let releaseLock = true;
    const stopHeartbeat = () => {
      if (!heartbeatTimer) {
        return;
      }

      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    };

    if (this.lockRefreshMs > 0 && this.lockRefreshMs < this.lockTtlMs) {
      heartbeatTimer = setInterval(() => {
        void this.refreshNonceLock(lockKey, lockValue)
          .then((refreshed) => {
            if (!refreshed) {
              lockHealthy = false;
              stopHeartbeat();
            }
          })
          .catch(() => {
            lockHealthy = false;
            stopHeartbeat();
          });
      }, this.lockRefreshMs);
      heartbeatTimer.unref?.();
    }

    const verifyLockOwnership = async (): Promise<boolean> => {
      if (!lockHealthy) {
        return false;
      }

      try {
        lockHealthy = await this.refreshNonceLock(lockKey, lockValue);
      } catch {
        lockHealthy = false;
      }
      return lockHealthy;
    };

    try {
      return await args.fn(verifyLockOwnership);
    } catch (error) {
      if (error instanceof AppError && error.code === 'IDEMPOTENCY_KEY_IN_DOUBT') {
        releaseLock = false;
      }
      throw error;
    } finally {
      stopHeartbeat();
      if (releaseLock && lockHealthy) {
        try {
          await this.releaseNonceLock(lockKey, lockValue);
        } catch {}
      }
    }
  }

  async submitContractTx(args: {
    chain: ChainContext;
    request: Record<string, unknown>;
    gasEstimate?: bigint;
  }): Promise<HexHash> {
    const { chain, request, gasEstimate } = args;
    const account = chain.walletClient.account;
    if (!account) {
      throw new AppError(
        500,
        'INTERNAL_ERROR',
        `Wallet account not configured for chain ${chain.chainId}`,
      );
    }

    return this.withChainLock(chain.chainId, async () =>
      this.withDistributedNonceLock({
        chainId: chain.chainId,
        address: account.address,
        fn: async (verifyLockOwnership) => {
          const pendingNonce = await chain.publicClient.getTransactionCount({
            address: account.address,
            blockTag: 'pending',
          });

          const broadcastInDoubt = () =>
            new AppError(
              409,
              'IDEMPOTENCY_KEY_IN_DOUBT',
              'Transaction broadcast result is ambiguous; verify the account nonce before retrying',
              {
                chainId: chain.chainId,
                accountAddress: account.address,
                nonce: pendingNonce,
              },
            );

          const transactionRequest = buildTransactionRequest(request);
          const preparedRequest = await chain.walletClient.prepareTransactionRequest({
            ...transactionRequest,
            account,
            nonce: pendingNonce,
            ...(gasEstimate ? { gas: gasEstimate } : {}),
          } as Parameters<typeof chain.walletClient.prepareTransactionRequest>[0]);
          const serializedTransaction = await chain.walletClient.signTransaction(
            preparedRequest as Parameters<typeof chain.walletClient.signTransaction>[0],
          );

          if (!(await verifyLockOwnership())) {
            throw new AppError(
              503,
              'NONCE_LOCK_LOST',
              'Distributed nonce lock was lost before transaction broadcast; retry the request',
            );
          }

          try {
            return (await chain.walletClient.sendRawTransaction({
              serializedTransaction,
            })) as HexHash;
          } catch (error) {
            if (isAmbiguousBroadcastError(error)) {
              throw broadcastInDoubt();
            }
            throw error;
          }
        },
      }),
    );
  }

  async submitCreateTx(args: {
    chain: ChainContext;
    request: Record<string, unknown>;
    gasEstimate?: bigint;
  }): Promise<HexHash> {
    return this.submitContractTx(args);
  }
}
