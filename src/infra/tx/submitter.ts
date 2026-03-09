import { randomUUID } from 'node:crypto';

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

const isNonceError = (error: unknown): boolean => {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('nonce too low') ||
    msg.includes('already known') ||
    msg.includes('replacement transaction underpriced')
  );
};

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
    fn: () => Promise<T>;
  }): Promise<T> {
    if (!this.redis) {
      return args.fn();
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
              stopHeartbeat();
            }
          })
          .catch(() => {
            // best-effort heartbeat; lock TTL sizing still provides safety margin
          });
      }, this.lockRefreshMs);
      heartbeatTimer.unref?.();
    }

    try {
      return await args.fn();
    } finally {
      stopHeartbeat();
      try {
        await this.releaseNonceLock(lockKey, lockValue);
      } catch {
        // best-effort release; TTL-based expiry still guarantees eventual unlock
      }
    }
  }

  async submitCreateTx(args: {
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
        fn: async () => {
          const pendingNonce = await chain.publicClient.getTransactionCount({
            address: account.address,
            blockTag: 'pending',
          });

          const txArgs = {
            ...request,
            nonce: pendingNonce,
            ...(gasEstimate ? { gas: gasEstimate } : {}),
          } as Record<string, unknown>;

          try {
            return (await chain.walletClient.writeContract(txArgs as any)) as HexHash;
          } catch (error) {
            if (!isNonceError(error)) throw error;

            const retryNonce = await chain.publicClient.getTransactionCount({
              address: account.address,
              blockTag: 'pending',
            });
            const retryArgs = { ...txArgs, nonce: retryNonce };
            return (await chain.walletClient.writeContract(retryArgs as any)) as HexHash;
          }
        },
      }),
    );
  }
}
