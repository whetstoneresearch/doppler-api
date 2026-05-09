# Configuration Reference

Runtime configuration is TypeScript-first:

- Canonical non-secret settings live in `doppler.config.ts`.
- Secrets and runtime overrides come from environment variables.
- The template object in `doppler.config.ts` must satisfy `DopplerTemplateConfigV1`.

## Canonical typed config

Edit `doppler.config.ts` for:

- EVM chain map and per-chain capabilities
- default EVM chain selection
- non-secret service defaults (port, logging, idempotency, pricing)

## Required environment variables

- `API_KEY`
- `PRIVATE_KEY`

## Optional core environment overrides

- `PORT`
- `DEPLOYMENT_MODE`
  - allowed: `standalone`, `shared`
  - defaults to `shared` when `NODE_ENV=production` and no explicit mode is set
- `DEFAULT_CHAIN_ID`
- `RPC_URL`
  - overrides the configured RPC only for `DEFAULT_CHAIN_ID`
- `DEFAULT_NUMERAIRE_ADDRESS`
  - overrides the configured numeraire only for `DEFAULT_CHAIN_ID`
- `READY_RPC_TIMEOUT_MS`
- `LOG_LEVEL`
- `CORS_ORIGINS`
- `API_KEYS`
- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MS`

## Idempotency environment variables

- `IDEMPOTENCY_ENABLED`
- `IDEMPOTENCY_BACKEND`
  - allowed: `file`, `redis`
- `IDEMPOTENCY_REQUIRE_KEY`
  - forced to `true` when `DEPLOYMENT_MODE=shared`
- `IDEMPOTENCY_TTL_MS`
- `IDEMPOTENCY_STORE_PATH`
- `IDEMPOTENCY_REDIS_LOCK_TTL_MS`
- `IDEMPOTENCY_REDIS_LOCK_REFRESH_MS`

Redis-backed idempotency writes `in_progress` markers for EVM flows and also persists Solana
`IDEMPOTENCY_KEY_IN_DOUBT` results so retries fail closed with the original error details.

## Pricing environment variables

- `PRICE_ENABLED`
- `PRICE_PROVIDER`
- `PRICE_BASE_URL`
- `PRICE_TIMEOUT_MS`
- `PRICE_CACHE_TTL_MS`
- `PRICE_API_KEY`
- `PRICE_COINGECKO_ASSET_ID`

## Solana environment variables

- `SOLANA_ENABLED`
- `SOLANA_DEFAULT_NETWORK`
  - allowed: `solanaDevnet`, `solanaMainnetBeta`
  - this uses canonical internal names only
- `SOLANA_DEVNET_RPC_URL`
- `SOLANA_DEVNET_WS_URL`
- `SOLANA_MAINNET_BETA_RPC_URL`
  - optional scaffolded setting
- `SOLANA_MAINNET_BETA_WS_URL`
  - optional scaffolded setting
- `SOLANA_KEYPAIR`
  - JSON array of 64 secret-key bytes for the payer
- `SOLANA_CONFIRM_TIMEOUT_MS`
  - confirmation wait before returning `409 IDEMPOTENCY_KEY_IN_DOUBT`
- `SOLANA_DEVNET_ALT_ADDRESS`
  - optional override for the default devnet ALT used on launch transactions
- `SOLANA_PRICE_MODE`
  - allowed: `required`, `fixed`, `coingecko`
- `SOLANA_FIXED_NUMERAIRE_PRICE_USD`
  - required when `SOLANA_PRICE_MODE=fixed`
- `SOLANA_COINGECKO_ASSET_ID`
  - defaults to `solana`

### Solana startup guardrails

When `SOLANA_ENABLED=true`, startup fails fast for static config errors:

- missing `SOLANA_KEYPAIR`
- missing `SOLANA_DEVNET_RPC_URL`
- missing `SOLANA_DEVNET_WS_URL`
- invalid `SOLANA_KEYPAIR` format
- invalid `SOLANA_DEFAULT_NETWORK`
- invalid `SOLANA_PRICE_MODE`
- missing `SOLANA_FIXED_NUMERAIRE_PRICE_USD` when `SOLANA_PRICE_MODE=fixed`

### Solana runtime notes

- Only `solanaDevnet` is executable in this API profile.
- `solanaMainnetBeta` is scaffolded in config and capabilities but returns `501 SOLANA_NETWORK_UNSUPPORTED`.
- WSOL is the only supported Solana numeraire.
- Launch transactions always use the deployed devnet ALT unless `SOLANA_DEVNET_ALT_ADDRESS` overrides it.
- Solana price resolution precedence is:
  1. request `pricing.numerairePriceUsd`
  2. `SOLANA_FIXED_NUMERAIRE_PRICE_USD`
  3. CoinGecko using `SOLANA_COINGECKO_ASSET_ID`
  4. otherwise `422 SOLANA_NUMERAIRE_PRICE_REQUIRED`

## Live test environment variables

- `LIVE_TEST_ENABLE`
- `LIVE_TEST_VERBOSE`
- `LIVE_NUMERAIRE_PRICE_USD`
- `LIVE_TEST_MIN_BALANCE_ETH`
- `LIVE_TEST_ESTIMATED_TX_COST_ETH`
- `LIVE_TEST_ESTIMATED_OVERHEAD_ETH`
- `LIVE_TEST_MIN_BALANCE_SOL`
- `LIVE_TEST_ESTIMATED_TX_COST_SOL`
- `LIVE_TEST_ESTIMATED_OVERHEAD_SOL`

### Solana live test notes

- `npm run test:live:solana` runs the full Solana devnet matrix.
- `npm run test:live:solana:devnet` is an explicit devnet alias.
- `npm run test:live:solana:defaults` runs the basic/default Solana create coverage.
- `npm run test:live:solana:random` runs randomized Solana parameter coverage.
- `npm run test:live:solana:failing` runs Solana route/policy failures without submitting launches.
- Set `LIVE_TEST_VERBOSE=true` for full per-launch output instead of the concise summary mode.
- The Solana readiness gate estimates required payer balance in SOL; override it with `LIVE_TEST_MIN_BALANCE_SOL` or tune the per-launch estimate with `LIVE_TEST_ESTIMATED_TX_COST_SOL` and `LIVE_TEST_ESTIMATED_OVERHEAD_SOL`.

## Multichain EVM configuration

Define EVM chains directly in `doppler.config.ts`:

```ts
chains: {
  84532: {
    rpcUrl: 'https://your-base-sepolia-rpc',
    defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
    auctionTypes: ['multicurve', 'dynamic'],
    migrationModes: ['noOp', 'uniswapV2', 'uniswapV4'],
    governanceModes: ['noOp', 'default'],
    governanceEnabled: true,
  },
  8453: {
    rpcUrl: 'https://your-base-mainnet-rpc',
    defaultNumeraireAddress: '0x4200000000000000000000000000000000000006',
    auctionTypes: ['multicurve'],
    migrationModes: ['noOp'],
    governanceModes: ['noOp', 'default'],
    governanceEnabled: true,
  },
}
```

### EVM notes

- Keys must be numeric chain IDs.
- `DEFAULT_CHAIN_ID` must reference an existing configured EVM chain.
- `launchId` is `<chainId>:<txHash>` for EVM launches.
- `RPC_URL` only overrides the default chain's RPC.
- `uniswapV3` migration is not supported and returns `501 MIGRATION_NOT_IMPLEMENTED`.

## Redis environment variables

- `REDIS_URL`
- `REDIS_KEY_PREFIX`

## Deployment mode guidance

- `standalone`: one API instance owns its own local state.
- `shared`: multiple API instances coordinate through Redis.

When `DEPLOYMENT_MODE=standalone`:

- Redis is optional.
- File-backed idempotency is the default.

When `DEPLOYMENT_MODE=shared`:

- `REDIS_URL` is required.
- `IDEMPOTENCY_ENABLED` must be `true`.
- `IDEMPOTENCY_BACKEND` must be `redis`.
- create endpoints require `Idempotency-Key`.
- rate-limiter state uses Redis for cross-replica consistency.
- startup fails fast if Redis cannot be reached.
