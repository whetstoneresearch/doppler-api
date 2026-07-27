import { describe, expect, it, vi } from 'vitest';
import { HttpRequestError, InsufficientFundsError } from 'viem';

import type { ChainContext } from '../../src/infra/chain/registry';
import { TxSubmitter, type TxSubmitterRedisClient } from '../../src/infra/tx/submitter';

const CONTRACT_REQUEST = {
  address: '0x2222222222222222222222222222222222222222',
  abi: [
    {
      type: 'function',
      name: 'create',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: [],
    },
  ],
  functionName: 'create',
  args: [],
} as const;
const ACCOUNT_ADDRESS = '0x1111111111111111111111111111111111111111';
const TX_HASH = `0x${'a'.repeat(64)}`;

const buildWalletClient = (options?: {
  prepareError?: Error;
  broadcastError?: Error;
  onPrepare?: (request: Record<string, unknown>) => void | Promise<void>;
  onSign?: (request: Record<string, unknown>) => void | Promise<void>;
  onBroadcast?: (request: { serializedTransaction: `0x${string}` }) => void | Promise<void>;
}) => ({
  account: { address: ACCOUNT_ADDRESS },
  prepareTransactionRequest: vi.fn(async (request: Record<string, unknown>) => {
    await options?.onPrepare?.(request);
    if (options?.prepareError) {
      throw options.prepareError;
    }
    return request;
  }),
  signTransaction: vi.fn(async (request: Record<string, unknown>) => {
    await options?.onSign?.(request);
    return '0x02' as const;
  }),
  sendRawTransaction: vi.fn(async (request: { serializedTransaction: `0x${string}` }) => {
    await options?.onBroadcast?.(request);
    if (options?.broadcastError) {
      throw options.broadcastError;
    }
    return TX_HASH;
  }),
});

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class FakeRedisClient implements TxSubmitterRedisClient {
  private readonly store = new Map<string, { value: string; expiresAtMs: number }>();

  private prune(key: string): void {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
    }
  }

  async set(
    key: string,
    value: string,
    mode: 'PX',
    durationMs: number,
    setMode?: 'NX',
  ): Promise<'OK' | null> {
    if (mode !== 'PX') {
      return null;
    }

    this.prune(key);
    if (setMode === 'NX' && this.store.has(key)) {
      return null;
    }

    this.store.set(key, {
      value,
      expiresAtMs: Date.now() + durationMs,
    });
    return 'OK';
  }

  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const lockKey = String(args[0]);
    const expectedValue = String(args[1]);
    this.prune(lockKey);
    const entry = this.store.get(lockKey);
    if (!entry || entry.value !== expectedValue) {
      return 0;
    }

    if (args.length >= 3) {
      const ttlMs = Number(args[2]);
      this.store.set(lockKey, {
        value: entry.value,
        expiresAtMs: Date.now() + ttlMs,
      });
      return 1;
    }

    this.store.delete(lockKey);
    return 1;
  }
}

describe('tx submitter', () => {
  it('preserves deterministic wallet errors instead of marking the broadcast in doubt', async () => {
    const insufficientFunds = new InsufficientFundsError();
    const walletClient = buildWalletClient({ broadcastError: insufficientFunds });
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn().mockResolvedValue(7),
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter();
    await expect(
      submitter.submitCreateTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toBe(insufficientFunds);
    expect(walletClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('marks nested transport failures as an ambiguous broadcast', async () => {
    const transportFailure = new HttpRequestError({
      url: 'https://rpc.example',
      cause: new Error('connection failed'),
    });
    const walletClient = buildWalletClient({
      broadcastError: new Error('contract write failed', { cause: transportFailure }),
    });
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn().mockResolvedValue(7),
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter();
    await expect(
      submitter.submitContractTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      statusCode: 409,
      details: {
        chainId: 84532,
        accountAddress: '0x1111111111111111111111111111111111111111',
        nonce: 7,
      },
    });
  });

  it('preserves deterministic HTTP provider rejections', async () => {
    const unauthorized = new HttpRequestError({
      url: 'https://rpc.example',
      status: 401,
    });
    const walletClient = buildWalletClient({ broadcastError: unauthorized });
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn().mockResolvedValue(7),
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter();
    await expect(
      submitter.submitContractTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toBe(unauthorized);
  });

  it('preserves transport failures that happen before raw broadcast', async () => {
    const preparationFailure = new HttpRequestError({
      url: 'https://rpc.example',
      status: 500,
    });
    const walletClient = buildWalletClient({ prepareError: preparationFailure });
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn().mockResolvedValue(7),
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter();
    await expect(
      submitter.submitContractTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toBe(preparationFailure);
    expect(walletClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each([
    'nonce too low',
    'already known',
    'replacement transaction underpriced',
    'request timed out after broadcast',
    'socket hang up',
  ])('fails closed without resubmitting after ambiguous "%s" broadcast errors', async (message) => {
    const getTransactionCount = vi.fn().mockResolvedValue(7);
    const walletClient = buildWalletClient({ broadcastError: new Error(message) });

    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount,
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter();
    await expect(
      submitter.submitCreateTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      statusCode: 409,
      details: {
        chainId: 84532,
        accountAddress: '0x1111111111111111111111111111111111111111',
        nonce: 7,
      },
    });

    expect(getTransactionCount).toHaveBeenCalledTimes(1);
    expect(walletClient.prepareTransactionRequest).toHaveBeenCalledTimes(1);
    expect(walletClient.prepareTransactionRequest.mock.calls[0][0].nonce).toBe(7);
    expect(walletClient.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns a retryable error before broadcast when the distributed nonce lock is lost', async () => {
    const redis = new FakeRedisClient();
    const refresh = vi
      .spyOn(redis, 'eval')
      .mockImplementation(
        async (_script: string, _numKeys: number, ...args: Array<string | number>) => {
          if (args.length >= 3) {
            return 0;
          }
          return 1;
        },
      );
    const walletClient = buildWalletClient();
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn(async () => {
          await sleep(20);
          return 7;
        }),
      },
      walletClient,
    } as unknown as ChainContext;

    const submitter = new TxSubmitter({
      redis,
      lockTtlMs: 100,
      lockRefreshMs: 5,
      lockPollIntervalMs: 1,
    });

    await expect(
      submitter.submitContractTx({
        chain,
        request: CONTRACT_REQUEST,
      }),
    ).rejects.toMatchObject({
      code: 'NONCE_LOCK_LOST',
      statusCode: 503,
    });
    expect(refresh).toHaveBeenCalled();
    expect(walletClient.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('revalidates distributed lock ownership immediately before broadcast', async () => {
    const redis = new FakeRedisClient();
    const events: string[] = [];
    vi.spyOn(redis, 'eval').mockImplementation(
      async (_script: string, _numKeys: number, ...args: Array<string | number>) => {
        events.push(args.length >= 3 ? 'refresh' : 'release');
        return 1;
      },
    );
    const walletClient = buildWalletClient({
      onPrepare: () => {
        events.push('prepare');
      },
      onSign: () => {
        events.push('sign');
      },
      onBroadcast: () => {
        events.push('broadcast');
      },
    });
    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount: vi.fn(async () => {
          events.push('nonce');
          return 7;
        }),
      },
      walletClient,
    } as unknown as ChainContext;
    const submitter = new TxSubmitter({
      redis,
      lockTtlMs: 500,
      lockRefreshMs: 0,
      lockPollIntervalMs: 1,
    });

    await submitter.submitContractTx({
      chain,
      request: CONTRACT_REQUEST,
    });

    expect(events).toEqual(['nonce', 'prepare', 'sign', 'refresh', 'broadcast', 'release']);
  });

  it('serializes nonce submission across submitter instances with shared redis lock', async () => {
    const redis = new FakeRedisClient();
    const firstSubmitter = new TxSubmitter({
      redis,
      redisKeyPrefix: 'test',
      lockTtlMs: 250,
      lockRefreshMs: 50,
      lockPollIntervalMs: 5,
    });
    const secondSubmitter = new TxSubmitter({
      redis,
      redisKeyPrefix: 'test',
      lockTtlMs: 250,
      lockRefreshMs: 50,
      lockPollIntervalMs: 5,
    });

    let nextNonce = 7;
    let writeInFlight = false;
    const getTransactionCount = vi.fn(async () => {
      await sleep(5);
      return nextNonce;
    });
    const preparedNonces: number[] = [];
    const sendRawTransaction = vi.fn(async () => {
      if (writeInFlight) {
        throw new Error('concurrent nonce write');
      }

      writeInFlight = true;
      await sleep(30);
      const txHash = `0x${String(nextNonce).padStart(64, 'a')}`;
      nextNonce += 1;
      writeInFlight = false;
      return txHash;
    });

    const buildChain = () =>
      ({
        chainId: 84532,
        publicClient: {
          getTransactionCount,
        },
        walletClient: {
          account: { address: ACCOUNT_ADDRESS },
          prepareTransactionRequest: vi.fn(async (request: { nonce: number }) => {
            preparedNonces.push(request.nonce);
            return request;
          }),
          signTransaction: vi.fn(async (request: { nonce: number }) => {
            return `0x${request.nonce.toString(16).padStart(2, '0')}`;
          }),
          sendRawTransaction,
        },
      }) as any;

    const [firstTxHash, secondTxHash] = await Promise.all([
      firstSubmitter.submitCreateTx({
        chain: buildChain(),
        request: CONTRACT_REQUEST,
      }),
      secondSubmitter.submitCreateTx({
        chain: buildChain(),
        request: CONTRACT_REQUEST,
      }),
    ]);

    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(preparedNonces).toEqual([7, 8]);
    expect(firstTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(secondTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
