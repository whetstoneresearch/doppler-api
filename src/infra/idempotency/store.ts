import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { AppError } from '../../core/errors';
import type { CreateLaunchRequestInput } from '../../modules/launches/schema';
import type { CreateLaunchResponse } from '../../core/types';

interface IdempotencyRecord {
  payloadHash: string;
  response: CreateLaunchResponse;
  createdAtMs: number;
}

interface PersistedStore {
  records: Record<string, IdempotencyRecord>;
}

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

export class IdempotencyStore {
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
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSE_MISMATCH',
          'Idempotency key was already used with a different request payload',
        );
      }
      return { response: existing.response, replayed: true };
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      if (inFlight.payloadHash !== payloadHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSE_MISMATCH',
          'Idempotency key is currently in-flight with a different request payload',
        );
      }
      const response = await inFlight.promise;
      return { response, replayed: true };
    }

    const promise = action();
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
