import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { IdempotencyBackend } from '../../core/config';
import { AppError } from '../../core/errors';
import type { CreateLaunchResponse } from '../../core/types';
import type { CreateLaunchRequestInput } from '../../modules/launches/schema';

interface IdempotencyRecord {
  payloadHash: string;
  response: CreateLaunchResponse;
  createdAtMs: number;
}

interface PersistedStore {
  records: Record<string, IdempotencyRecord>;
}

export interface IdempotencyStore {
  execute(
    key: string,
    payload: CreateLaunchRequestInput,
    action: () => Promise<CreateLaunchResponse>,
  ): Promise<{ response: CreateLaunchResponse; replayed: boolean }>;
}

export interface IdempotencyRedisClient {
  get(key: string): Promise<string | null>;
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

const hashPayload = (payload: CreateLaunchRequestInput): string =>
  createHash('sha256').update(stableStringify(payload)).digest('hex');

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const throwKeyReuseMismatch = (message: string): never => {
  throw new AppError(409, 'IDEMPOTENCY_KEY_REUSE_MISMATCH', message);
};

export class FileIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly inFlight = new Map<
    string,
    { payloadHash: string; promise: Promise<CreateLaunchResponse> }
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
      const parsed = JSON.parse(raw) as PersistedStore;
      for (const [key, record] of Object.entries(parsed.records ?? {})) {
        this.records.set(key, record);
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
    payload: CreateLaunchRequestInput,
    action: () => Promise<CreateLaunchResponse>,
  ): Promise<{ response: CreateLaunchResponse; replayed: boolean }> {
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
        payloadHash,
        response,
        createdAtMs: Date.now(),
      });
      this.persist();
      return { response, replayed: false };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly inFlight = new Map<
    string,
    { payloadHash: string; promise: Promise<CreateLaunchResponse> }
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

  private async readRecord(key: string): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.get(this.recordKey(key));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<IdempotencyRecord>;
      if (
        typeof parsed.payloadHash !== 'string' ||
        typeof parsed.createdAtMs !== 'number' ||
        parsed.response === undefined
      ) {
        return null;
      }

      return parsed as IdempotencyRecord;
    } catch {
      return null;
    }
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
  ): Promise<IdempotencyRecord | null> {
    const lockKey = this.lockKey(key);

    for (;;) {
      const existing = await this.readRecord(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throwKeyReuseMismatch(
            'Idempotency key was already used with a different request payload',
          );
        }
        return existing;
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
    action: () => Promise<CreateLaunchResponse>,
  ): Promise<{ response: CreateLaunchResponse; replayed: boolean }> {
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

    const promise = Promise.resolve().then(action);
    this.inFlight.set(key, { payloadHash, promise });

    try {
      const response = await promise;
      const record: IdempotencyRecord = {
        payloadHash,
        response,
        createdAtMs: Date.now(),
      };

      await this.redis.set(this.recordKey(key), JSON.stringify(record), 'PX', this.ttlMs);
      return { response, replayed: false };
    } finally {
      stopHeartbeat();
      this.inFlight.delete(key);
      await this.releaseLock(key, lockValue);
    }
  }

  async execute(
    key: string,
    payload: CreateLaunchRequestInput,
    action: () => Promise<CreateLaunchResponse>,
  ): Promise<{ response: CreateLaunchResponse; replayed: boolean }> {
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

      const lockValue = await this.tryAcquireLock(key, payloadHash);
      if (lockValue) {
        return this.executeWithLock(key, payloadHash, lockValue, action);
      }

      const replay = await this.waitForRecordOrUnlock(key, payloadHash);
      if (replay) {
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
