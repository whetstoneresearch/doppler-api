import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config';
import { ChainRegistry } from '../../src/infra/chain/registry';

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
    'ETHEREUM_RPC_URL',
    'MONAD_RPC_URL',
    'ROBINHOOD_RPC_URL',
    'BASE_RPC_URL',
    'BASE_SEPOLIA_RPC_URL',
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
    'SOLANA_KEYPAIR_PATH',
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
  it.each([
    [1, 'ETHEREUM_RPC_URL'],
    [143, 'MONAD_RPC_URL'],
    [4663, 'ROBINHOOD_RPC_URL'],
    [8453, 'BASE_RPC_URL'],
    [84532, 'BASE_SEPOLIA_RPC_URL'],
  ])(
    'enables only chain %d without inferring a default when %s is configured',
    (chainId, rpcEnvVar) => {
      resetEnv({ [rpcEnvVar]: `https://rpc-${chainId}.example` });

      const config = loadConfig();

      expect(config.defaultChainId).toBeNull();
      expect(Object.keys(config.chains).map(Number)).toEqual([chainId]);
      expect(config.chains[chainId]?.rpcUrl).toBe(`https://rpc-${chainId}.example`);
    },
  );

  it('resolves configured chains in the canonical mapping order', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      MONAD_RPC_URL: 'https://rpc-monad.example',
    });

    const config = loadConfig();

    expect(Object.keys(config.chains).map(Number)).toEqual([143, 8453]);
    expect(config.defaultChainId).toBeNull();
  });

  it('constructs canonical SDK address bundles for every configured chain', () => {
    resetEnv({
      ETHEREUM_RPC_URL: 'https://rpc-ethereum.example',
      MONAD_RPC_URL: 'https://rpc-monad.example',
      ROBINHOOD_RPC_URL: 'https://rpc-robinhood.example',
      BASE_RPC_URL: 'https://rpc-base.example',
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
    });

    const registry = new ChainRegistry(loadConfig());

    expect(registry.list().map((chain) => chain.chainId)).toEqual([1, 143, 4663, 8453, 84532]);
  });

  it('does not infer Base Sepolia as the default when it is enabled', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
    });

    const config = loadConfig();

    expect(config.defaultChainId).toBeNull();
  });

  it('uses an explicitly configured default', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      DEFAULT_CHAIN_ID: '8453',
    });

    const config = loadConfig();

    expect(config.defaultChainId).toBe(8453);
  });

  it('uses only named chain RPC URLs when RPC_URL is present', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      DEFAULT_CHAIN_ID: '8453',
      RPC_URL: 'http://localhost:8545',
    });

    const config = loadConfig();

    expect(config.chains[8453]?.rpcUrl).toBe('https://rpc-base.example');
    expect(config.chains[84532]?.rpcUrl).toBe('https://rpc-base-sepolia.example');
  });

  it('applies DEFAULT_NUMERAIRE_ADDRESS only to the resolved default chain', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      DEFAULT_CHAIN_ID: '8453',
      DEFAULT_NUMERAIRE_ADDRESS: '0x1111111111111111111111111111111111111111',
    });

    const config = loadConfig();

    expect(config.chains[8453]?.defaultNumeraireAddress).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(config.chains[84532]?.defaultNumeraireAddress).toBe(
      '0x4200000000000000000000000000000000000006',
    );
  });

  it('rejects DEFAULT_NUMERAIRE_ADDRESS without an explicit default chain', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      DEFAULT_NUMERAIRE_ADDRESS: '0x1111111111111111111111111111111111111111',
    });

    expect(() => loadConfig()).toThrow('DEFAULT_NUMERAIRE_ADDRESS requires DEFAULT_CHAIN_ID');
  });

  it('fails when no chain-specific RPC URL is configured', () => {
    resetEnv();

    expect(() => loadConfig()).toThrow('No chain-specific RPC URL is configured');
  });

  it('fails when an explicit default is outside the configured subset', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      DEFAULT_CHAIN_ID: '84532',
    });

    expect(() => loadConfig()).toThrow(
      'DEFAULT_CHAIN_ID 84532 does not have a configured named RPC URL',
    );
  });

  it('fails when an explicit default chain ID is unsupported', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      DEFAULT_CHAIN_ID: '999999',
    });

    expect(() => loadConfig()).toThrow(
      'DEFAULT_CHAIN_ID 999999 does not have a configured named RPC URL',
    );
  });

  it('applies env override for coingecko asset id', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      PRICE_COINGECKO_ASSET_ID: 'usd-coin',
    });

    const config = loadConfig();

    expect(config.pricing.coingeckoAssetId).toBe('usd-coin');
  });

  it('loads canonical Solana defaults and Solana CoinGecko asset id', () => {
    resetEnv({ BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example' });

    const config = loadConfig();

    expect(config.solana.defaultNetwork).toBe('solanaDevnet');
    expect(config.solana.devnetRpcUrl).toBe('https://api.devnet.solana.com');
    expect(config.solana.devnetWsUrl).toBe('wss://api.devnet.solana.com');
    expect(config.solana.coingeckoAssetId).toBe('solana');
  });

  it('fails fast when DEFAULT_CHAIN_ID does not have a named RPC URL', () => {
    resetEnv({
      BASE_RPC_URL: 'https://rpc-base.example',
      DEFAULT_CHAIN_ID: '1',
    });

    expect(() => loadConfig()).toThrow(
      'DEFAULT_CHAIN_ID 1 does not have a configured named RPC URL',
    );
  });

  it('forces idempotency keys in shared mode', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
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

  it('allows standalone deployments to disable idempotency', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      IDEMPOTENCY_ENABLED: 'false',
    });

    expect(loadConfig().idempotency.enabled).toBe(false);
  });

  it('rejects disabling idempotency in shared mode', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      DEPLOYMENT_MODE: 'shared',
      REDIS_URL: 'redis://127.0.0.1:6379',
      IDEMPOTENCY_BACKEND: 'redis',
      IDEMPOTENCY_ENABLED: 'false',
    });

    expect(() => loadConfig()).toThrow(
      'IDEMPOTENCY_ENABLED must be true when DEPLOYMENT_MODE=shared',
    );
  });

  it('fails fast when shared mode is missing REDIS_URL', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      DEPLOYMENT_MODE: 'shared',
      IDEMPOTENCY_BACKEND: 'redis',
    });

    expect(() => loadConfig()).toThrow(/REDIS_URL is required/);
  });

  it('rejects file idempotency backend in shared mode', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
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
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
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
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      SOLANA_KEYPAIR: '[1,2,3]',
    });

    expect(() => loadConfig()).toThrow(
      'SOLANA_KEYPAIR must be a JSON array containing 64 secret-key bytes',
    );
  });

  it('loads a Solana keypair from a file path', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'doppler-api-keypair-'));
    const keypairPath = join(tempDirectory, 'payer.json');
    const keypairBytes = Array.from({ length: 64 }, (_, index) => index);

    try {
      writeFileSync(keypairPath, JSON.stringify(keypairBytes));
      resetEnv({
        BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
        SOLANA_KEYPAIR_PATH: keypairPath,
      });

      const config = loadConfig();

      expect(Array.from(config.solana.keypairBytes ?? [])).toEqual(keypairBytes);
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  });

  it('rejects ambiguous Solana keypair env sources', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      SOLANA_KEYPAIR: JSON.stringify(Array.from({ length: 64 }, (_, index) => index)),
      SOLANA_KEYPAIR_PATH: '/tmp/payer.json',
    });

    expect(() => loadConfig()).toThrow('Set only one of SOLANA_KEYPAIR or SOLANA_KEYPAIR_PATH');
  });

  it('fails fast when Solana is enabled without a keypair', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
      SOLANA_ENABLED: 'true',
      SOLANA_DEVNET_RPC_URL: 'http://127.0.0.1:8899',
      SOLANA_DEVNET_WS_URL: 'ws://127.0.0.1:8900',
    });

    expect(() => loadConfig()).toThrow(
      'SOLANA_KEYPAIR_PATH or SOLANA_KEYPAIR is required when SOLANA_ENABLED=true',
    );
  });

  it('fails fast when fixed Solana pricing is enabled without a fixed price', () => {
    resetEnv({
      BASE_SEPOLIA_RPC_URL: 'https://rpc-base-sepolia.example',
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
