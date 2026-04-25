import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config';

const ORIGINAL_ENV = { ...process.env };

const resetEnv = (overrides: Record<string, string | undefined> = {}): void => {
  process.env = {
    ...ORIGINAL_ENV,
    API_KEY: 'test-key',
    PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945386f3f6f3d1063f4042afe30de8f34a4c9e',
    NODE_ENV: 'test',
  };

  const keysToUnset = [
    'RPC_URL',
    'DEFAULT_CHAIN_ID',
    'DEFAULT_NUMERAIRE_ADDRESS',
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
    'PRICE_COINGECKO_ASSET_ID',
    'SOLANA_ENABLED',
    'SOLANA_DEFAULT_NETWORK',
    'SOLANA_DEVNET_RPC_URL',
    'SOLANA_DEVNET_WS_URL',
    'SOLANA_MAINNET_BETA_RPC_URL',
    'SOLANA_MAINNET_BETA_WS_URL',
    'SOLANA_KEYPAIR',
    'SOLANA_CONFIRM_TIMEOUT_MS',
    'SOLANA_DEVNET_ALT_ADDRESS',
    'SOLANA_PRICE_MODE',
    'SOLANA_FIXED_NUMERAIRE_PRICE_USD',
    'SOLANA_COINGECKO_ASSET_ID',
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
  it('loads defaults from typed config without requiring RPC_URL', () => {
    resetEnv();

    const config = loadConfig();

    expect(config.defaultChainId).toBe(84532);
    expect(config.chains[84532]?.rpcUrl).toBe('https://base-sepolia-rpc.publicnode.com');
    expect(config.deploymentMode).toBe('standalone');
    expect(config.idempotency.backend).toBe('file');
    expect(config.idempotency.requireKey).toBe(false);
    expect(config.redis.url).toBeUndefined();
  });

  it('applies env overrides to default chain runtime values', () => {
    resetEnv({
      RPC_URL: 'http://localhost:8545',
      DEFAULT_NUMERAIRE_ADDRESS: '0x1111111111111111111111111111111111111111',
    });

    const config = loadConfig();

    expect(config.chains[config.defaultChainId]?.rpcUrl).toBe('http://localhost:8545');
    expect(config.chains[config.defaultChainId]?.defaultNumeraireAddress).toBe(
      '0x1111111111111111111111111111111111111111',
    );
  });

  it('applies env override for coingecko asset id', () => {
    resetEnv({
      PRICE_COINGECKO_ASSET_ID: 'usd-coin',
    });

    const config = loadConfig();

    expect(config.pricing.coingeckoAssetId).toBe('usd-coin');
  });

  it('loads canonical Solana defaults and Solana CoinGecko asset id', () => {
    resetEnv();

    const config = loadConfig();

    expect(config.solana.defaultNetwork).toBe('solanaDevnet');
    expect(config.solana.devnetRpcUrl).toBe('https://api.devnet.solana.com');
    expect(config.solana.devnetWsUrl).toBe('wss://api.devnet.solana.com');
    expect(config.solana.coingeckoAssetId).toBe('solana');
  });

  it('fails fast when DEFAULT_CHAIN_ID is not in typed config', () => {
    resetEnv({
      DEFAULT_CHAIN_ID: '1',
    });

    expect(() => loadConfig()).toThrow('DEFAULT_CHAIN_ID 1 is not configured in doppler.config.ts');
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

  it('rejects invalid Solana keypair env values', () => {
    resetEnv({
      SOLANA_KEYPAIR: '[1,2,3]',
    });

    expect(() => loadConfig()).toThrow(
      'SOLANA_KEYPAIR must be a JSON array containing 64 secret-key bytes',
    );
  });

  it('fails fast when Solana is enabled without a keypair', () => {
    resetEnv({
      SOLANA_ENABLED: 'true',
      SOLANA_DEVNET_RPC_URL: 'http://127.0.0.1:8899',
      SOLANA_DEVNET_WS_URL: 'ws://127.0.0.1:8900',
    });

    expect(() => loadConfig()).toThrow('SOLANA_KEYPAIR is required when SOLANA_ENABLED=true');
  });

  it('fails fast when fixed Solana pricing is enabled without a fixed price', () => {
    resetEnv({
      SOLANA_ENABLED: 'true',
      SOLANA_DEVNET_RPC_URL: 'http://127.0.0.1:8899',
      SOLANA_DEVNET_WS_URL: 'ws://127.0.0.1:8900',
      SOLANA_KEYPAIR: JSON.stringify(Array.from({ length: 64 }, (_, index) => index)),
      SOLANA_PRICE_MODE: 'fixed',
    });

    expect(() => loadConfig()).toThrow(
      'SOLANA_FIXED_NUMERAIRE_PRICE_USD is required when SOLANA_PRICE_MODE=fixed',
    );
  });
});
