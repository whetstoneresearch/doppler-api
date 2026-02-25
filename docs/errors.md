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

## Common status codes

- `401` unauthorized (`x-api-key` missing/invalid)
- `422` validation or business-rule failure
- `501` planned but not implemented functionality
- `502` upstream or chain lookup failures
- `500` internal errors

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

- Dynamic creation is currently work in progress (preview).
- Dynamic launches require `migration.type="uniswapV2"`.
- `migration.type="uniswapV3"` currently returns `501 MIGRATION_NOT_IMPLEMENTED`.
- `migration.type="uniswapV4"` currently returns `501 MIGRATION_NOT_IMPLEMENTED`.

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
- `INVALID_CHAIN_CONFIG_JSON`
- `INVALID_CHAIN_ID`
- `UNSUPPORTED_CHAIN`
