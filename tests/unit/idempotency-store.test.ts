import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/core/errors';
import type { CreateLaunchResponse } from '../../src/core/types';
import {
  FileIdempotencyStore,
  RedisIdempotencyStore,
  type IdempotencyRedisClient,
} from '../../src/infra/idempotency/store';

const samplePayload = {
  userAddress: '0x1111111111111111111111111111111111111111',
  tokenMetadata: { name: 'Token', symbol: 'TOK', tokenURI: 'ipfs://token' },
  economics: { totalSupply: '1000' },
  governance: { enabled: false, mode: 'noOp' as const },
  migration: { type: 'noOp' as const },
  auction: {
    type: 'multicurve' as const,
    curveConfig: { type: 'preset' as const },
  },
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',');
  return `{${body}}`;
};

const hashPayload = (payload: unknown): string =>
  createHash('sha256').update(stableStringify(payload)).digest('hex');

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildResponse = (txHash: `0x${string}`): CreateLaunchResponse => ({
  launchId: `84532:${txHash}`,
  chainId: 84532,
  txHash,
  statusUrl: `/v1/launches/84532:${txHash}`,
  predicted: {
    tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    poolId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  },
  effectiveConfig: {
    tokensForSale: '1000',
    allocationAmount: '0',
    allocationRecipient: '0x1111111111111111111111111111111111111111',
    allocationLockMode: 'none',
    allocationLockDurationSeconds: 0,
    numeraireAddress: '0x4200000000000000000000000000000000000006',
    numerairePriceUsd: 1000,
    feeBeneficiariesSource: 'default',
  },
});

const buildSolanaInDoubtError = () =>
  new AppError(
    409,
    'SOLANA_LAUNCH_IN_DOUBT',
    'Solana launch confirmation is in doubt',
    {
      launchId: '8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP',
      signature:
        '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
      explorerUrl:
        'https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet',
    },
  );

class FakeRedisClient implements IdempotencyRedisClient {
  private readonly store = new Map<string, { value: string; expiresAtMs: number }>();

  private prune(key: string): void {
    const entry = this.store.get(key);
    if (!entry) return;
    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.prune(key);
    const entry = this.store.get(key);
    return entry?.value ?? null;
  }

  async del(key: string): Promise<number> {
    this.prune(key);
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
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

  async pttl(key: string): Promise<number> {
    this.prune(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    return Math.max(0, entry.expiresAtMs - Date.now());
  }

  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const lockKey = String(args[0]);
    const expectedValue = String(args[1]);
    const currentValue = await this.get(lockKey);
    if (currentValue !== expectedValue) {
      return 0;
    }

    if (args.length >= 3) {
      const ttlMs = Number(args[2]);
      this.store.set(lockKey, {
        value: currentValue,
        expiresAtMs: Date.now() + ttlMs,
      });
      return 1;
    }

    this.store.delete(lockKey);
    return 1;
  }
}

class FlakyCompletedWriteRedisClient extends FakeRedisClient {
  private failCompletedWriteOnce = true;

  override async set(
    key: string,
    value: string,
    mode: 'PX',
    durationMs: number,
    setMode?: 'NX',
  ): Promise<'OK' | null> {
    if (
      setMode !== 'NX' &&
      key.includes(':record:') &&
      value.includes('"state":"completed"') &&
      this.failCompletedWriteOnce
    ) {
      this.failCompletedWriteOnce = false;
      throw new Error('simulated redis write failure after launch success');
    }

    return super.set(key, value, mode, durationMs, setMode);
  }
}

describe('idempotency store', () => {
  it('file backend replays same key and payload', async () => {
    const runId = Date.now().toString();
    const store = new FileIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      path: `.test-results/idempotency-unit-test-${runId}.json`,
    });

    const first = await store.execute('abc', samplePayload as any, async () =>
      buildResponse('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );

    const second = await store.execute('abc', samplePayload as any, async () => {
      throw new Error('should not be called');
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((second.response as CreateLaunchResponse).txHash).toBe(
      (first.response as CreateLaunchResponse).txHash,
    );
  });

  it('file backend rejects same key with different payload', async () => {
    const runId = (Date.now() + 1).toString();
    const store = new FileIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      path: `.test-results/idempotency-unit-test-2-${runId}.json`,
    });

    await store.execute('abc', samplePayload as any, async () =>
      buildResponse('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );

    await expect(
      store.execute(
        'abc',
        {
          ...samplePayload,
          tokenMetadata: { ...samplePayload.tokenMetadata, symbol: 'DIFF' },
        } as any,
        async () => {
          throw new Error('should not be called');
        },
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
      statusCode: 409,
    });
  });

  it('redis backend replays same key and payload', async () => {
    const redis = new FakeRedisClient();
    const store = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
    });

    const first = await store.execute('abc', samplePayload as any, async () =>
      buildResponse('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );

    const second = await store.execute('abc', samplePayload as any, async () => {
      throw new Error('should not be called');
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((second.response as CreateLaunchResponse).txHash).toBe(
      (first.response as CreateLaunchResponse).txHash,
    );
  });

  it('redis backend rejects same key with different payload', async () => {
    const redis = new FakeRedisClient();
    const store = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
    });

    await store.execute('abc', samplePayload as any, async () =>
      buildResponse('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );

    await expect(
      store.execute(
        'abc',
        {
          ...samplePayload,
          tokenMetadata: { ...samplePayload.tokenMetadata, symbol: 'DIFF' },
        } as any,
        async () => {
          throw new Error('should not be called');
        },
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
      statusCode: 409,
    });
  });

  it('redis backend dedupes in-flight requests across store instances', async () => {
    const redis = new FakeRedisClient();
    const firstStore = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
    });
    const secondStore = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
    });

    let actionExecutions = 0;
    const firstPromise = firstStore.execute('shared', samplePayload as any, async () => {
      actionExecutions += 1;
      await sleep(25);
      return buildResponse('0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd');
    });

    await sleep(5);

    const secondPromise = secondStore.execute('shared', samplePayload as any, async () => {
      throw new Error('should not be called');
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(actionExecutions).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((second.response as CreateLaunchResponse).txHash).toBe(
      (first.response as CreateLaunchResponse).txHash,
    );
  });

  it('redis lock heartbeat prevents duplicate execution after lock TTL window', async () => {
    const redis = new FakeRedisClient();
    const firstStore = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
      lockTtlMs: 50,
      lockRefreshMs: 10,
      pollIntervalMs: 5,
    });
    const secondStore = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
      lockTtlMs: 50,
      lockRefreshMs: 10,
      pollIntervalMs: 5,
    });

    let actionExecutions = 0;
    const firstPromise = firstStore.execute('long-running', samplePayload as any, async () => {
      actionExecutions += 1;
      await sleep(120);
      return buildResponse('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    });

    await sleep(70);

    const secondPromise = secondStore.execute('long-running', samplePayload as any, async () => {
      actionExecutions += 1;
      return buildResponse('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(actionExecutions).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect((second.response as CreateLaunchResponse).txHash).toBe(
      (first.response as CreateLaunchResponse).txHash,
    );
  });

  it('redis backend fails closed when recovering in-progress key without lock', async () => {
    const redis = new FakeRedisClient();
    await redis.set(
      'test:idempotency:record:crash-window',
      JSON.stringify({
        state: 'in_progress',
        payloadHash: hashPayload(samplePayload),
        createdAtMs: Date.now(),
      }),
      'PX',
      100_000,
    );

    const store = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
      lockTtlMs: 250,
      lockRefreshMs: 50,
      pollIntervalMs: 5,
    });

    await expect(
      store.execute('crash-window', samplePayload as any, async () => {
        throw new Error('should not be called');
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      statusCode: 409,
    });
  });

  it('redis backend fails closed when completed record write fails after action success', async () => {
    const redis = new FlakyCompletedWriteRedisClient();
    const store = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
      lockTtlMs: 250,
      lockRefreshMs: 50,
      pollIntervalMs: 5,
    });

    let actionExecutions = 0;

    await expect(
      store.execute('completed-write-failure', samplePayload as any, async () => {
        actionExecutions += 1;
        return buildResponse('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      }),
    ).rejects.toThrow('simulated redis write failure after launch success');

    await expect(
      store.execute('completed-write-failure', samplePayload as any, async () => {
        actionExecutions += 1;
        return buildResponse('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_IN_DOUBT',
      statusCode: 409,
    });

    expect(actionExecutions).toBe(1);
  });

  it('file backend persists Solana in-doubt results and fails closed on retry', async () => {
    const runId = (Date.now() + 2).toString();
    const store = new FileIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      path: `.test-results/idempotency-unit-test-solana-${runId}.json`,
    });

    await expect(
      store.execute('solana-in-doubt', samplePayload as any, async () => {
        throw buildSolanaInDoubtError();
      }),
    ).rejects.toMatchObject({
      code: 'SOLANA_LAUNCH_IN_DOUBT',
      statusCode: 409,
    });

    await expect(
      store.execute('solana-in-doubt', samplePayload as any, async () => {
        throw new Error('should not be called');
      }),
    ).rejects.toMatchObject({
      code: 'SOLANA_LAUNCH_IN_DOUBT',
      statusCode: 409,
      details: {
        launchId: '8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP',
      },
    });
  });

  it('redis backend persists Solana in-doubt results and fails closed on retry', async () => {
    const redis = new FakeRedisClient();
    const store = new RedisIdempotencyStore({
      enabled: true,
      ttlMs: 100_000,
      redis,
      keyPrefix: 'test',
    });

    await expect(
      store.execute('solana-in-doubt', samplePayload as any, async () => {
        throw buildSolanaInDoubtError();
      }),
    ).rejects.toMatchObject({
      code: 'SOLANA_LAUNCH_IN_DOUBT',
      statusCode: 409,
    });

    await expect(
      store.execute('solana-in-doubt', samplePayload as any, async () => {
        throw new Error('should not be called');
      }),
    ).rejects.toMatchObject({
      code: 'SOLANA_LAUNCH_IN_DOUBT',
      statusCode: 409,
      details: {
        signature:
          '5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J',
      },
    });
  });
});
