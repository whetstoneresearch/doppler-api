# Configuration Reference

## Required environment variables

- `API_KEY`
- `PRIVATE_KEY`
- `RPC_URL` (required unless `CHAIN_CONFIG_JSON` defines the default chain)

## Optional environment variables

- `PORT` (default: `3000`)
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

## Idempotency environment variables

- `IDEMPOTENCY_ENABLED` (default: `true`)
- `IDEMPOTENCY_REQUIRE_KEY` (default: `false`)
- `IDEMPOTENCY_TTL_MS` (default: `86400000`)
- `IDEMPOTENCY_STORE_PATH` (default: `.data/idempotency-store.json`)

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
    "auctionTypes": ["multicurve"],
    "migrationModes": ["noOp"],
    "governanceModes": ["noOp"],
    "governanceEnabled": false
  },
  "8453": {
    "rpcUrl": "https://your-base-mainnet-rpc",
    "defaultNumeraireAddress": "0x4200000000000000000000000000000000000006",
    "auctionTypes": ["multicurve"],
    "migrationModes": ["noOp"],
    "governanceModes": ["noOp"],
    "governanceEnabled": false
  }
}
```

### Notes

- Keys must be numeric chain IDs.
- If default chain is not present in `CHAIN_CONFIG_JSON`, the API falls back to `RPC_URL`.
- `launchId` is always `<chainId>:<txHash>` to preserve cross-chain identity.
- `governance: true` is currently unsupported and returns `501 GOVERNANCE_NOT_IMPLEMENTED`.
