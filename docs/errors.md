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
- 5xx responses return a generic client-safe message (`"Internal server error"`).
  Full diagnostics remain in server logs.

## Common status codes

- `401` unauthorized (`x-api-key` missing/invalid)
- `429` rate limit exceeded (`RATE_LIMITED`)
- `422` validation or business-rule failure
- `501` planned but not implemented functionality
- `502` upstream or chain lookup failures
- `500` internal errors

## Operational

- `RATE_LIMITED`

## Known domain error codes

### Authentication

- `UNAUTHORIZED`

### Launch creation and policy

- `AUCTION_TYPE_UNSUPPORTED`
- `MIGRATION_NOT_IMPLEMENTED`
- `MIGRATION_MODE_UNSUPPORTED`
- `GOVERNANCE_MODE_UNSUPPORTED`
- `NUMERAIRE_REQUIRED`
- `INVALID_TOKENOMICS`
  - includes allocation errors such as:
    - `tokensForSale` below 20% market minimum when using split allocations
    - non-market allocation sums not matching `totalSupply - tokensForSale`
    - duplicate non-market allocation addresses
    - more than 10 allocation addresses
- `INVALID_BIGINT`
- `INVALID_FEE_BENEFICIARIES`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_KEY_REUSE_MISMATCH`

Dynamic-specific policy notes:

- Dynamic launches require `migration.type="uniswapV2"` or `migration.type="uniswapV4"`.
- `migration.type="uniswapV4"` requires `migration.fee` and `migration.tickSpacing`.
- `migration.type="uniswapV3"` currently returns `501 MIGRATION_NOT_IMPLEMENTED`.

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

### Config

- `MISSING_ENV`
- `INVALID_ENV`
- `REDIS_UNAVAILABLE`
- `INVALID_CHAIN_CONFIG_JSON`
- `INVALID_CHAIN_ID`
- `UNSUPPORTED_CHAIN`

Shared-mode guardrail notes:

- `DEPLOYMENT_MODE=shared` requires `REDIS_URL`.
- `DEPLOYMENT_MODE=shared` requires `IDEMPOTENCY_ENABLED=true` and `IDEMPOTENCY_BACKEND=redis`.
- startup returns `REDIS_UNAVAILABLE` if Redis is configured but unreachable.
