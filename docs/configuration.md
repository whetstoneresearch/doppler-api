# Configuration Reference

## Required environment variables

- `API_KEY`
- `PRIVATE_KEY`
- `RPC_URL` (required unless `CHAIN_CONFIG_JSON` defines the default chain)

## Optional environment variables

- `PORT` (default: `3000`)
- `DEPLOYMENT_MODE` (default: `local`)
  - allowed: `local`, `shared`
  - if unset and `NODE_ENV=production`, deployment mode defaults to `shared`
- `DEFAULT_CHAIN_ID` (default: `84532`)
- `DEFAULT_NUMERAIRE_ADDRESS` (default from chain addresses)
- `READY_RPC_TIMEOUT_MS` (default: `2000`)
- `LOG_LEVEL` (default: `info`)
- `CORS_ORIGINS`
  - Comma-separated allowlist.
  - Empty means CORS is disabled.
- `API_KEYS`
  - Optional comma-separated additional API keys.
- `RATE_LIMIT_MAX` (default: `100`)
- `RATE_LIMIT_WINDOW_MS` (default: `60000`)

## Redis environment variables

- `REDIS_URL`
- `REDIS_KEY_PREFIX` (default: `doppler-api`)

## Idempotency environment variables

- `IDEMPOTENCY_ENABLED` (default: `true`)
- `IDEMPOTENCY_BACKEND` (default: `file`, allowed: `file`, `redis`)
- `IDEMPOTENCY_REQUIRE_KEY` (default: `false`)
  - forced to `true` when `DEPLOYMENT_MODE=shared`
- `IDEMPOTENCY_TTL_MS` (default: `86400000`)
- `IDEMPOTENCY_STORE_PATH` (default: `.data/idempotency-store.json`)
- `IDEMPOTENCY_REDIS_LOCK_TTL_MS` (default: `900000`)
  - TTL for cross-replica in-flight idempotency lock
  - set this to at least your max expected create-launch duration
- `IDEMPOTENCY_REDIS_LOCK_REFRESH_MS` (default: `300000`)
  - heartbeat interval for refreshing the Redis in-flight lock
  - must be lower than `IDEMPOTENCY_REDIS_LOCK_TTL_MS`

## Shared mode guardrails

When `DEPLOYMENT_MODE=shared`:

- `REDIS_URL` is required.
- `IDEMPOTENCY_ENABLED` must be `true`.
- `IDEMPOTENCY_BACKEND` must be `redis`.
- create endpoints require `Idempotency-Key`.
- rate-limiter state uses Redis for cross-replica consistency.
- startup fails fast if Redis cannot be reached.

Local mode remains file-backed by default and does not require Redis.

## Pricing environment variables

- `PRICE_ENABLED` (default: `true`)
- `PRICE_PROVIDER` (default: `coingecko`)
- `PRICE_BASE_URL` (default: `https://api.coingecko.com/api/v3`)
- `PRICE_TIMEOUT_MS` (default: `3000`)
- `PRICE_CACHE_TTL_MS` (default: `15000`)
- `PRICE_API_KEY` (optional)
- `PRICE_COINGECKO_ASSET_ID` (default: `ethereum`)

## Multichain configuration

Use `CHAIN_CONFIG_JSON` to define one or more chains and capabilities:

```json
{
  "84532": {
    "rpcUrl": "https://your-base-sepolia-rpc",
    "defaultNumeraireAddress": "0x4200000000000000000000000000000000000006",
    "auctionTypes": ["multicurve", "dynamic"],
    "migrationModes": ["noOp", "uniswapV2", "uniswapV4"],
    "governanceModes": ["noOp", "default"],
    "governanceEnabled": true
  },
  "8453": {
    "rpcUrl": "https://your-base-mainnet-rpc",
    "defaultNumeraireAddress": "0x4200000000000000000000000000000000000006",
    "auctionTypes": ["multicurve"],
    "migrationModes": ["noOp"],
    "governanceModes": ["noOp", "default"],
    "governanceEnabled": true
  }
}
```

### Notes

- Keys must be numeric chain IDs.
- If default chain is not present in `CHAIN_CONFIG_JSON`, the API falls back to `RPC_URL`.
- `launchId` is always `<chainId>:<txHash>` to preserve cross-chain identity.
- `governance` create behavior is binary:
  - `false` or omitted uses no governance
  - `true` uses default token-holder governance (OpenZeppelin Governor) via the governance factory when `governanceModes` includes `default` and `governanceEnabled=true`
- Recommendation: configure `auctionTypes` with `["multicurve", "dynamic"]` for V4-capable deployments and reserve `["static"]` for networks without Uniswap V4 support.
- Dynamic launches require `migrationModes` to include `"uniswapV2"` and/or `"uniswapV4"`.
- `uniswapV3` migration is not supported and returns `501 MIGRATION_NOT_IMPLEMENTED` if requested.
- If you intentionally want the V3 static path on Base Sepolia for testing, include `"static"` in that chain's `auctionTypes` list.
