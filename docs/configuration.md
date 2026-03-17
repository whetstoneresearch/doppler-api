# Configuration Reference

Runtime configuration is TypeScript-first:

- Canonical non-secret settings live in `doppler.config.ts`.
- Secrets and operational runtime overrides come from environment variables.
- The template object in `doppler.config.ts` must satisfy `DopplerTemplateConfigV1`.
  If the shape drifts, `npm run typecheck` / `npm run build` fails.

## Canonical typed config

Edit `doppler.config.ts` for:

- chain map and per-chain capabilities
- default chain selection
- non-secret service defaults (port, logging, idempotency defaults, pricing defaults)

## Required environment variables

- `API_KEY`
- `PRIVATE_KEY`

## Optional environment overrides

- `PORT` (default from `doppler.config.ts`)
- `DEPLOYMENT_MODE` (default from `doppler.config.ts`)
  - allowed: `standalone`, `shared`
  - if unset and `NODE_ENV=production`, deployment mode defaults to `shared`
- `DEFAULT_CHAIN_ID` (must exist in `doppler.config.ts`)
- `RPC_URL`
  - overrides `rpcUrl` for `DEFAULT_CHAIN_ID` only
- `DEFAULT_NUMERAIRE_ADDRESS`
  - overrides `defaultNumeraireAddress` for `DEFAULT_CHAIN_ID` only
- `READY_RPC_TIMEOUT_MS` (default from `doppler.config.ts`)
- `LOG_LEVEL` (default from `doppler.config.ts`)
- `CORS_ORIGINS`
  - Comma-separated allowlist.
  - Empty means CORS is disabled.
- `API_KEYS`
  - Optional comma-separated additional API keys.
- `RATE_LIMIT_MAX` (default from `doppler.config.ts`)
- `RATE_LIMIT_WINDOW_MS` (default from `doppler.config.ts`)

## Idempotency environment variables

- `IDEMPOTENCY_ENABLED` (default from `doppler.config.ts`)
- `IDEMPOTENCY_BACKEND` (default from `doppler.config.ts`, allowed: `file`, `redis`)
- `IDEMPOTENCY_REQUIRE_KEY` (default from `doppler.config.ts`)
  - forced to `true` when `DEPLOYMENT_MODE=shared`
- `IDEMPOTENCY_TTL_MS` (default from `doppler.config.ts`)
- `IDEMPOTENCY_STORE_PATH` (default from `doppler.config.ts`)
- `IDEMPOTENCY_REDIS_LOCK_TTL_MS` (default from `doppler.config.ts`)
  - TTL for cross-replica in-flight idempotency lock
  - set this to at least your max expected create-launch duration
- `IDEMPOTENCY_REDIS_LOCK_REFRESH_MS` (default from `doppler.config.ts`)
  - heartbeat interval for refreshing the Redis in-flight lock
  - must be lower than `IDEMPOTENCY_REDIS_LOCK_TTL_MS`

## Pricing environment variables

- `PRICE_ENABLED` (default from `doppler.config.ts`)
- `PRICE_PROVIDER` (default from `doppler.config.ts`)
- `PRICE_BASE_URL` (default from `doppler.config.ts`)
- `PRICE_TIMEOUT_MS` (default from `doppler.config.ts`)
- `PRICE_CACHE_TTL_MS` (default from `doppler.config.ts`)
- `PRICE_API_KEY` (optional)
- `PRICE_COINGECKO_ASSET_ID` (default from `doppler.config.ts`)

## Multichain configuration

Define chains directly in `doppler.config.ts`:

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

### Notes

- Keys must be numeric chain IDs.
- `DEFAULT_CHAIN_ID` must reference an existing key in `doppler.config.ts`.
- `RPC_URL` only overrides the configured `rpcUrl` for `DEFAULT_CHAIN_ID`.
- `launchId` is always `<chainId>:<txHash>` to preserve cross-chain identity.
- `governance` create behavior is binary:
  - `false` or omitted uses no governance
  - `true` uses default token-holder governance (OpenZeppelin Governor) via the governance factory when `governanceModes` includes `default` and `governanceEnabled=true`
- Recommendation: configure `auctionTypes` with `["multicurve", "dynamic"]` for V4-capable deployments and reserve `["static"]` for networks without Uniswap V4 support.
- Dynamic launches require `migrationModes` to include `"uniswapV2"` and/or `"uniswapV4"`.
- `uniswapV3` migration is not supported and returns `501 MIGRATION_NOT_IMPLEMENTED` if requested.
- If you intentionally want the V3 static path on Base Sepolia for testing, include `"static"` in that chain's `auctionTypes` list.

## Redis environment variables

- `REDIS_URL`
- `REDIS_KEY_PREFIX` (default from `doppler.config.ts`)

## Deployment mode guidance

- `standalone`: one API instance owns its own local state and does not need cross-instance coordination.
- `shared`: multiple API instances can serve the same workload safely by coordinating through Redis.

When `DEPLOYMENT_MODE=standalone`:

- Redis is optional.
- File-backed idempotency is the default.
- Good fit for one API instance, one signer, and a durable local filesystem.
- Redis is recommended if you want stronger crash/restart recovery around create requests.

When `DEPLOYMENT_MODE=shared`:

- `REDIS_URL` is required.
- `IDEMPOTENCY_ENABLED` must be `true`.
- `IDEMPOTENCY_BACKEND` must be `redis`.
- create endpoints require `Idempotency-Key`.
- rate-limiter state uses Redis for cross-replica consistency.
- tx nonce submission uses a Redis-backed distributed signer lock for cross-replica coordination.
- startup fails fast if Redis cannot be reached.

`NODE_ENV=production` with no explicit `DEPLOYMENT_MODE` resolves to `shared`.

Redis-backed idempotency writes an `in_progress` marker before create submit.
If a process crashes/restarts before completion, retries with the same key fail closed with
`409 IDEMPOTENCY_KEY_IN_DOUBT` until operators verify prior attempt status.
