import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { IdempotencyBackend } from '../../core/config';
import { AppError } from '../../core/errors';
import type { CreateAnyLaunchResponse } from '../../core/types';

interface CompletedIdempotencyRecord {
  state: 'completed';
  payloadHash: string;
  response: CreateAnyLaunchResponse;
  createdAtMs: number;
}

interface InDoubtIdempotencyRecord {
  state: 'in_doubt';
  payloadHash: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  createdAtMs: number;
}

type IdempotencyRecord = CompletedIdempotencyRecord | InDoubtIdempotencyRecord;

interface RedisInProgressRecord {
  state: 'in_progress';
  payloadHash: string;
  createdAtMs: number;
}

interface RedisCompletedRecord {
  state: 'completed';
  payloadHash: string;
  response: CreateAnyLaunchResponse;
  createdAtMs: number;
}

interface RedisInDoubtRecord {
  state: 'in_doubt';
  payloadHash: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  createdAtMs: number;
}

type RedisIdempotencyRecord = RedisInProgressRecord | RedisCompletedRecord | RedisInDoubtRecord;

interface PersistedStore {
  records: Record<string, IdempotencyRecord>;
}

const idempotencyErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

const persistedRecordBaseSchema = z.object({
  payloadHash: z.string(),
  createdAtMs: z.number(),
});

const completedRecordSchema = persistedRecordBaseSchema.extend({
  state: z.literal('completed'),
  response: z.unknown(),
});

const legacyCompletedRecordSchema = persistedRecordBaseSchema.extend({
  response: z.unknown(),
});

const inDoubtRecordSchema = persistedRecordBaseSchema.extend({
  state: z.literal('in_doubt'),
  error: idempotencyErrorSchema,
});

const inProgressRecordSchema = persistedRecordBaseSchema.extend({
  state: z.literal('in_progress'),
});

const persistedStoreSchema = z.object({
  records: z.record(z.unknown()).default({}),
});

export interface IdempotencyStore {
  execute(
    key: string,
    payload: unknown,
    action: () => Promise<CreateAnyLaunchResponse>,
  ): Promise<{ response: CreateAnyLaunchResponse; replayed: boolean }>;
}

export interface IdempotencyRedisClient {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    durationMs: number,
    setMode?: 'NX',
  ): Promise<'OK' | null>;
  pttl(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const DEFAULT_REDIS_LOCK_TTL_MS = 900_000;
const DEFAULT_REDIS_LOCK_REFRESH_MS = 300_000;
const DEFAULT_REDIS_POLL_INTERVAL_MS = 200;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const REFRESH_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

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

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const throwKeyReuseMismatch = (message: string): never => {
  throw new AppError(409, 'IDEMPOTENCY_KEY_REUSE_MISMATCH', message);
};

const throwInDoubtError = (): never => {
  throw new AppError(
    409,
    'IDEMPOTENCY_KEY_IN_DOUBT',
    'Idempotency key is in progress from a previous attempt; verify launch status before retrying',
  );
};

const isPersistableInDoubtError = (error: unknown): error is AppError =>
  error instanceof AppError &&
  error.code === 'IDEMPOTENCY_KEY_IN_DOUBT' &&
  typeof error.details === 'object' &&
  error.details !== null &&
  typeof (error.details as { launchId?: unknown }).launchId === 'string' &&
  typeof (error.details as { signature?: unknown }).signature === 'string' &&
  typeof (error.details as { explorerUrl?: unknown }).explorerUrl === 'string';

const parseFileRecord = (record: unknown): IdempotencyRecord | null => {
  const inDoubtRecord = inDoubtRecordSchema.safeParse(record);
  if (inDoubtRecord.success) {
    return inDoubtRecord.data;
  }

  const completedRecord = completedRecordSchema.safeParse(record);
  if (completedRecord.success) {
    return {
      state: 'completed',
      payloadHash: completedRecord.data.payloadHash,
      response: completedRecord.data.response as CreateAnyLaunchResponse,
      createdAtMs: completedRecord.data.createdAtMs,
    };
  }

  const legacyCompletedRecord = legacyCompletedRecordSchema.safeParse(record);
  if (legacyCompletedRecord.success) {
    return {
      state: 'completed',
      payloadHash: legacyCompletedRecord.data.payloadHash,
      response: legacyCompletedRecord.data.response as CreateAnyLaunchResponse,
      createdAtMs: legacyCompletedRecord.data.createdAtMs,
    };
  }

  return null;
};

const parseRedisRecord = (record: unknown): RedisIdempotencyRecord | null => {
  const inProgressRecord = inProgressRecordSchema.safeParse(record);
  if (inProgressRecord.success) {
    return inProgressRecord.data;
  }

  return parseFileRecord(record);
};

export class FileIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly inFlight = new Map<
    string,
    { payloadHash: string; promise: Promise<CreateAnyLaunchResponse> }
  >();
  private readonly ttlMs: number;
  private readonly path: string;
  private readonly enabled: boolean;

  constructor(args: { enabled: boolean; ttlMs: number; path: string }) {
    this.enabled = args.enabled;
    this.ttlMs = args.ttlMs;
    this.path = args.path;

    if (!this.enabled) return;
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = persistedStoreSchema.parse(JSON.parse(raw));
      for (const [key, record] of Object.entries(parsed.records)) {
        const parsedRecord = parseFileRecord(record);
        if (parsedRecord) {
          this.records.set(key, parsedRecord);
        }
      }
      this.pruneExpired();
    } catch {
      // Ignore missing/corrupt store and start clean.
    }
  }

  private persist(): void {
    if (!this.enabled) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const payload: PersistedStore = {
      records: Object.fromEntries(this.records.entries()),
    };
    writeFileSync(this.path, JSON.stringify(payload), 'utf8');
  }

  private pruneExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, record] of this.records.entries()) {
      if (now - record.createdAtMs > this.ttlMs) {
        this.records.delete(key);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  async execute(
    key: string,
    payload: unknown,
    action: () => Promise<CreateAnyLaunchResponse>,
  ): Promise<{ response: CreateAnyLaunchResponse; replayed: boolean }> {
    if (!this.enabled) {
      return { response: await action(), replayed: false };
    }

    this.pruneExpired();
    const payloadHash = hashPayload(payload);
    const existing = this.records.get(key);

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throwKeyReuseMismatch('Idempotency key was already used with a different request payload');
      }
      if (existing.state === 'in_doubt') {
        throw new AppError(
          409,
          existing.error.code,
          existing.error.message,
          existing.error.details,
        );
      }
      return { response: existing.response, replayed: true };
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      if (inFlight.payloadHash !== payloadHash) {
        throwKeyReuseMismatch(
          'Idempotency key is currently in-flight with a different request payload',
        );
      }
      const response = await inFlight.promise;
      return { response, replayed: true };
    }

    const promise = Promise.resolve().then(action);
    this.inFlight.set(key, { payloadHash, promise });
    try {
      const response = await promise;
      this.records.set(key, {
        state: 'completed',
        payloadHash,
        response,
        createdAtMs: Date.now(),
      });
      this.persist();
      return { response, replayed: false };
    } catch (error) {
      if (isPersistableInDoubtError(error)) {
        this.records.set(key, {
          state: 'in_doubt',
          payloadHash,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          createdAtMs: Date.now(),
        });
        this.persist();
        throw error;
      }
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly inFlight = new Map<
    string,
    { payloadHash: string; promise: Promise<CreateAnyLaunchResponse> }
  >();
  private readonly enabled: boolean;
  private readonly ttlMs: number;
  private readonly redis: IdempotencyRedisClient;
  private readonly keyPrefix: string;
  private readonly lockTtlMs: number;
  private readonly lockRefreshMs: number;
  private readonly pollIntervalMs: number;

  constructor(args: {
    enabled: boolean;
    ttlMs: number;
    redis: IdempotencyRedisClient;
    keyPrefix: string;
    lockTtlMs?: number;
    lockRefreshMs?: number;
    pollIntervalMs?: number;
  }) {
    this.enabled = args.enabled;
    this.ttlMs = args.ttlMs;
    this.redis = args.redis;
    this.keyPrefix = args.keyPrefix;
    this.lockTtlMs = args.lockTtlMs ?? DEFAULT_REDIS_LOCK_TTL_MS;
    this.lockRefreshMs =
      args.lockRefreshMs ?? Math.min(DEFAULT_REDIS_LOCK_REFRESH_MS, Math.floor(this.lockTtlMs / 3));
    this.pollIntervalMs = args.pollIntervalMs ?? DEFAULT_REDIS_POLL_INTERVAL_MS;
  }

  private recordKey(key: string): string {
    return `${this.keyPrefix}:idempotency:record:${key}`;
  }

  private lockKey(key: string): string {
    return `${this.keyPrefix}:idempotency:inflight:${key}`;
  }

  private readLockPayloadHash(lockValue: string): string | null {
    const separatorIndex = lockValue.indexOf('|');
    if (separatorIndex === -1) {
      return lockValue.length > 0 ? lockValue : null;
    }
    const payloadHash = lockValue.slice(0, separatorIndex);
    return payloadHash.length > 0 ? payloadHash : null;
  }

  private async readRecord(key: string): Promise<RedisIdempotencyRecord | null> {
    const raw = await this.redis.get(this.recordKey(key));
    if (!raw) {
      return null;
    }

    try {
      return parseRedisRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async writeInProgressRecord(key: string, payloadHash: string): Promise<void> {
    const record: RedisInProgressRecord = {
      state: 'in_progress',
      payloadHash,
      createdAtMs: Date.now(),
    };
    await this.redis.set(this.recordKey(key), JSON.stringify(record), 'PX', this.ttlMs);
  }

  private async writeCompletedRecord(
    key: string,
    payloadHash: string,
    response: CreateAnyLaunchResponse,
  ): Promise<void> {
    const record: RedisCompletedRecord = {
      state: 'completed',
      payloadHash,
      response,
      createdAtMs: Date.now(),
    };

    await this.redis.set(this.recordKey(key), JSON.stringify(record), 'PX', this.ttlMs);
  }

  private async writeInDoubtRecord(
    key: string,
    payloadHash: string,
    error: AppError,
  ): Promise<void> {
    const record: RedisInDoubtRecord = {
      state: 'in_doubt',
      payloadHash,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      createdAtMs: Date.now(),
    };

    await this.redis.set(this.recordKey(key), JSON.stringify(record), 'PX', this.ttlMs);
  }

  private async clearRecord(key: string): Promise<void> {
    await this.redis.del(this.recordKey(key));
  }

  private async tryAcquireLock(key: string, payloadHash: string): Promise<string | null> {
    const lockValue = `${payloadHash}|${randomUUID()}`;
    const result = await this.redis.set(this.lockKey(key), lockValue, 'PX', this.lockTtlMs, 'NX');
    return result === 'OK' ? lockValue : null;
  }

  private async releaseLock(key: string, lockValue: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey(key), lockValue);
  }

  private async refreshLock(key: string, lockValue: string): Promise<boolean> {
    const result = await this.redis.eval(
      REFRESH_LOCK_SCRIPT,
      1,
      this.lockKey(key),
      lockValue,
      this.lockTtlMs,
    );
    return result === 1;
  }

  private async waitForRecordOrUnlock(
    key: string,
    payloadHash: string,
  ): Promise<RedisCompletedRecord | RedisInDoubtRecord | null> {
    const lockKey = this.lockKey(key);

    for (;;) {
      const existing = await this.readRecord(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throwKeyReuseMismatch(
            'Idempotency key was already used with a different request payload',
          );
        }
        if (existing.state === 'completed') {
          return existing;
        }
        if (existing.state === 'in_doubt') {
          return existing;
        }
      }

      const lockValue = await this.redis.get(lockKey);
      if (!lockValue) {
        return null;
      }

      const inFlightPayloadHash = this.readLockPayloadHash(lockValue);
      if (inFlightPayloadHash && inFlightPayloadHash !== payloadHash) {
        throwKeyReuseMismatch(
          'Idempotency key is currently in-flight with a different request payload',
        );
      }

      const ttlMs = await this.redis.pttl(lockKey);
      const waitMs = ttlMs > 0 ? Math.min(this.pollIntervalMs, ttlMs) : this.pollIntervalMs;
      await delay(Math.max(waitMs, 25));
    }
  }

  private async executeWithLock(
    key: string,
    payloadHash: string,
    lockValue: string,
    action: () => Promise<CreateAnyLaunchResponse>,
  ): Promise<{ response: CreateAnyLaunchResponse; replayed: boolean }> {
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let actionCompleted = false;
    const stopHeartbeat = () => {
      if (!heartbeatTimer) {
        return;
      }
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    };

    if (this.lockRefreshMs > 0 && this.lockRefreshMs < this.lockTtlMs) {
      heartbeatTimer = setInterval(() => {
        void this.refreshLock(key, lockValue)
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
      await this.writeInProgressRecord(key, payloadHash);
      const promise = Promise.resolve().then(action);
      this.inFlight.set(key, { payloadHash, promise });
      const response = await promise;
      actionCompleted = true;
      await this.writeCompletedRecord(key, payloadHash, response);
      return { response, replayed: false };
    } catch (error) {
      if (isPersistableInDoubtError(error)) {
        await this.writeInDoubtRecord(key, payloadHash, error);
      } else if (!actionCompleted) {
        try {
          await this.clearRecord(key);
        } catch {
          // best-effort cleanup; retries still protected by lock + existing record checks
        }
      }
      throw error;
    } finally {
      stopHeartbeat();
      this.inFlight.delete(key);
      await this.releaseLock(key, lockValue);
    }
  }

  async execute(
    key: string,
    payload: unknown,
    action: () => Promise<CreateAnyLaunchResponse>,
  ): Promise<{ response: CreateAnyLaunchResponse; replayed: boolean }> {
    if (!this.enabled) {
      return { response: await action(), replayed: false };
    }

    const payloadHash = hashPayload(payload);

    for (;;) {
      const existing = await this.readRecord(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throwKeyReuseMismatch(
            'Idempotency key was already used with a different request payload',
          );
        }

        if (existing.state === 'completed') {
          return { response: existing.response, replayed: true };
        }

        if (existing.state === 'in_doubt') {
          throw new AppError(
            409,
            existing.error.code,
            existing.error.message,
            existing.error.details,
          );
        }

        const replay = await this.waitForRecordOrUnlock(key, payloadHash);
        if (replay) {
          if (replay.state === 'in_doubt') {
            throw new AppError(409, replay.error.code, replay.error.message, replay.error.details);
          }
          return { response: replay.response, replayed: true };
        }

        const afterWait = await this.readRecord(key);
        if (afterWait?.state === 'in_progress') {
          throwInDoubtError();
        }

        continue;
      }

      const inFlight = this.inFlight.get(key);
      if (inFlight) {
        if (inFlight.payloadHash !== payloadHash) {
          throwKeyReuseMismatch(
            'Idempotency key is currently in-flight with a different request payload',
          );
        }
        const response = await inFlight.promise;
        return { response, replayed: true };
      }

      const lockValue = await this.tryAcquireLock(key, payloadHash);
      if (lockValue) {
        return this.executeWithLock(key, payloadHash, lockValue, action);
      }

      const replay = await this.waitForRecordOrUnlock(key, payloadHash);
      if (replay) {
        if (replay.state === 'in_doubt') {
          throw new AppError(409, replay.error.code, replay.error.message, replay.error.details);
        }
        return { response: replay.response, replayed: true };
      }
    }
  }
}

export const createIdempotencyStore = (args: {
  enabled: boolean;
  backend: IdempotencyBackend;
  ttlMs: number;
  path: string;
  redis?: IdempotencyRedisClient;
  redisKeyPrefix: string;
  redisLockTtlMs: number;
  redisLockRefreshMs: number;
}): IdempotencyStore => {
  if (args.backend === 'redis') {
    if (!args.redis) {
      throw new AppError(
        500,
        'MISSING_ENV',
        'REDIS_URL is required when IDEMPOTENCY_BACKEND=redis',
      );
    }

    return new RedisIdempotencyStore({
      enabled: args.enabled,
      ttlMs: args.ttlMs,
      redis: args.redis,
      keyPrefix: args.redisKeyPrefix,
      lockTtlMs: args.redisLockTtlMs,
      lockRefreshMs: args.redisLockRefreshMs,
    });
  }

  return new FileIdempotencyStore({
    enabled: args.enabled,
    ttlMs: args.ttlMs,
    path: args.path,
  });
};
