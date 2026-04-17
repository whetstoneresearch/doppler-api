# Error Handling

## Error response shape

All errors are returned as:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

- `details` is optional.
- Validation failures return `422 INVALID_REQUEST` with structured zod details.
- `5xx` responses return a generic client-safe message (`"Internal server error"`).

## Common status codes

- `401` unauthorized
- `409` idempotency or in-doubt create failure
- `422` validation or business-rule failure
- `429` rate limit exceeded
- `501` unsupported but intentionally scaffolded functionality
- `502` upstream, simulation, or submission failure
- `500` internal errors

## Known error codes

### Authentication

- `UNAUTHORIZED`

### EVM launch creation and policy

- `AUCTION_TYPE_UNSUPPORTED`
- `MIGRATION_NOT_IMPLEMENTED`
- `MIGRATION_MODE_UNSUPPORTED`
- `GOVERNANCE_MODE_UNSUPPORTED`
- `NUMERAIRE_REQUIRED`
- `INVALID_ECONOMICS`
- `INVALID_BIGINT`
- `INVALID_FEE_BENEFICIARIES`

### Solana creation

- `SOLANA_NETWORK_UNSUPPORTED`
  - returned when Solana is disabled or `solanaMainnetBeta` is requested
- `SOLANA_NUMERAIRE_UNSUPPORTED`
  - only WSOL is supported in this iteration
- `SOLANA_NUMERAIRE_PRICE_REQUIRED`
  - no request override, fixed price, or CoinGecko price was available
- `SOLANA_INVALID_METADATA`
- `SOLANA_INVALID_CURVE`
- `SOLANA_NOT_READY`
  - readiness gates failed before create
- `SOLANA_SIMULATION_FAILED`
  - returned when simulation fails before submit
- `SOLANA_SUBMISSION_FAILED`
  - returned when submit fails or a submitted transaction is later rejected
- `SOLANA_LAUNCH_IN_DOUBT`
  - returned as `409` when submit succeeded but confirmation remained ambiguous
  - includes `details: { launchId, signature, explorerUrl }`

### Pricing

- `INVALID_PRICE_OVERRIDE`
- `PRICE_REQUIRED`
- `PRICE_UNSUPPORTED_NUMERAIRE`
- `PRICE_UPSTREAM_ERROR`
- `PRICE_UPSTREAM_INVALID`
- `PRICE_FETCH_FAILED`

### Status / chain resolution

- `INVALID_LAUNCH_ID`
- `CHAIN_NOT_CONFIGURED`
- `CHAIN_LOOKUP_FAILED`
- `CREATE_EVENT_NOT_FOUND`
- `CREATE_TX_DECODE_FAILED`

### Idempotency

- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_KEY_REUSE_MISMATCH`
- `IDEMPOTENCY_KEY_IN_DOUBT`
  - EVM retry failed closed because an earlier same-key request may have submitted
- `SOLANA_LAUNCH_IN_DOUBT`
  - same-key Solana retries fail closed with the original in-doubt details

### Config

- `MISSING_ENV`
- `INVALID_ENV`
- `REDIS_UNAVAILABLE`
- `UNSUPPORTED_CHAIN`

## Operational notes

- `GET /ready` intentionally sanitizes dependency failure messages to `"dependency unavailable"`.
- Shared mode requires Redis-backed idempotency and reachable Redis at startup.
