import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config';

const ORIGINAL_ENV = { ...process.env };

const resetEnv = (overrides: Record<string, string | undefined> = {}): void => {
  process.env = {
    ...ORIGINAL_ENV,
    API_KEY: 'test-key',
    PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945386f3f6f3d1063f4042afe30de8f34a4c9e',
    RPC_URL: 'http://localhost:8545',
    NODE_ENV: 'test',
  };

  const keysToUnset = [
    'CHAIN_CONFIG_JSON',
    'DEPLOYMENT_MODE',
    'REDIS_URL',
    'REDIS_KEY_PREFIX',
    'IDEMPOTENCY_ENABLED',
    'IDEMPOTENCY_BACKEND',
    'IDEMPOTENCY_REQUIRE_KEY',
    'IDEMPOTENCY_TTL_MS',
    'IDEMPOTENCY_STORE_PATH',
    'IDEMPOTENCY_REDIS_LOCK_TTL_MS',
    'IDEMPOTENCY_REDIS_LOCK_REFRESH_MS',
  ];

  for (const key of keysToUnset) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('shared-environment config guardrails', () => {
  it('defaults to local mode with file idempotency backend', () => {
    resetEnv();

    const config = loadConfig();

    expect(config.deploymentMode).toBe('local');
    expect(config.idempotency.backend).toBe('file');
    expect(config.idempotency.requireKey).toBe(false);
    expect(config.redis.url).toBeUndefined();
  });

  it('forces idempotency keys in shared mode', () => {
    resetEnv({
      DEPLOYMENT_MODE: 'shared',
      REDIS_URL: 'redis://127.0.0.1:6379',
      IDEMPOTENCY_BACKEND: 'redis',
      IDEMPOTENCY_REQUIRE_KEY: 'false',
    });

    const config = loadConfig();

    expect(config.deploymentMode).toBe('shared');
    expect(config.idempotency.backend).toBe('redis');
    expect(config.idempotency.requireKey).toBe(true);
  });

  it('fails fast when shared mode is missing REDIS_URL', () => {
    resetEnv({
      DEPLOYMENT_MODE: 'shared',
      IDEMPOTENCY_BACKEND: 'redis',
    });

    expect(() => loadConfig()).toThrow(/REDIS_URL is required/);
  });

  it('rejects file idempotency backend in shared mode', () => {
    resetEnv({
      DEPLOYMENT_MODE: 'shared',
      REDIS_URL: 'redis://127.0.0.1:6379',
      IDEMPOTENCY_BACKEND: 'file',
    });

    expect(() => loadConfig()).toThrow(
      'IDEMPOTENCY_BACKEND must be "redis" when DEPLOYMENT_MODE=shared',
    );
  });

  it('rejects redis lock refresh interval that is not lower than lock ttl', () => {
    resetEnv({
      IDEMPOTENCY_BACKEND: 'redis',
      REDIS_URL: 'redis://127.0.0.1:6379',
      IDEMPOTENCY_REDIS_LOCK_TTL_MS: '1000',
      IDEMPOTENCY_REDIS_LOCK_REFRESH_MS: '1000',
    });

    expect(() => loadConfig()).toThrow(
      'IDEMPOTENCY_REDIS_LOCK_REFRESH_MS must be less than IDEMPOTENCY_REDIS_LOCK_TTL_MS',
    );
  });
});
