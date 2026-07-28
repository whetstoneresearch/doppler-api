# Error Reference

## Response envelope

Errors use this response shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

`details` is optional. Zod validation failures return `422 INVALID_REQUEST` with structured validation details.

For `5xx` responses, the API preserves the error code but replaces the message with `"Internal server error"` and omits `details`.

## HTTP statuses

| Status | Meaning |
| --- | --- |
| `401` | Authentication failed |
| `404` | The requested resource was not found |
| `409` | The request conflicts with an idempotency record, an earlier submission may be in doubt, or a generated token address already exists |
| `422` | Request validation or a business rule failed |
| `429` | Rate limit exceeded |
| `500` | Internal error or invalid service configuration |
| `501` | The requested network is not enabled for execution |
| `502` | An upstream lookup, simulation, or submission failed |
| `503` | A required runtime readiness or coordination condition failed |

## Error codes

### Request and authentication

| Code              | Status | Meaning                                                 |
| ----------------- | ------ | ------------------------------------------------------- |
| `UNAUTHORIZED`    | `401`  | The `x-api-key` is missing or invalid.                  |
| `INVALID_REQUEST` | `422`  | The request does not match the accepted schema.         |
| `RATE_LIMITED`    | `429`  | The caller exceeded the configured rate limit.          |
| `REQUEST_FAILED`  | `4xx`  | A non-`AppError` client failure did not provide a code. |
| `INTERNAL_ERROR`  | `500`  | An unhandled error occurred.                            |

### EVM launch creation

| Code | Status | Meaning |
| --- | --- | --- |
| `AUCTION_TYPE_UNSUPPORTED` | `422` | The auction type is not enabled for the selected chain or route. |
| `MIGRATION_MODE_UNSUPPORTED` | `422` | The migration mode is not enabled for the selected chain. |
| `GOVERNANCE_MODE_UNSUPPORTED` | `422` | The governance mode is not enabled for the selected chain. |
| `NUMERAIRE_REQUIRED` | `422` | No numeraire was supplied or configured. |
| `INVALID_ECONOMICS` | `422` | Token allocation, vesting, curve, fee, or economic bounds are invalid. |
| `INVALID_TOKEN_CONFIG` | `422` | Token configuration is invalid. |
| `INVALID_BIGINT` | `422` | A contract integer is malformed or outside its accepted range. |
| `INVALID_FEE_BENEFICIARIES` | `422` | Fee beneficiaries are invalid, duplicated, out of range, or do not sum to the required total. |
| `INVALID_MARKET_CAP_PRESET` | `422` | The static-auction market-cap preset is invalid. |
| `LOCKABLE_V3_INITIALIZER_UNSUPPORTED` | `422` | The selected chain does not configure the initializer required by the request. |
| `UNSUPPORTED_CHAIN` | `500` | The server does not support the chain required by the resolved launch configuration. |
| `TOKEN_ADDRESS_COLLISION` | `409` | The SDK-generated salt resolves to an address that already contains token bytecode. |

EVM request schemas reject unknown properties and unsupported migration shapes as `422 INVALID_REQUEST`. `poolFeeBeneficiaries` cannot be used with `migration.type="uniswapV2"`; that migration accepts its singular `feeBeneficiary` with an integer percentage from 1 through 50. Migration is accepted only for dynamic launches.

Rehype requests must provide exactly one of `buybackDestination` or `rehypeFeeBeneficiaries`. Rehype beneficiaries must be unique, positive, and sum to `1e18`; the Airlock owner is not added automatically. Malformed EVM integer-string and WAD fields are schema failures and return `422 INVALID_REQUEST`; they are never reported as internal server errors.

`TOKEN_ADDRESS_COLLISION` is returned only when an Airlock `DeploymentFailed()` simulation identifies the predicted DopplerERC20V1 address and that address already has bytecode in pending chain state. Create simulation also uses pending state, preventing an unmined deployment from being submitted again. Retry the create request so the SDK generates a different salt. Other simulation failures retain their original error.

### Solana launch creation and lookup

| Code | Status | Meaning |
| --- | --- | --- |
| `SOLANA_NETWORK_UNSUPPORTED` | `501` | Solana is disabled or `solanaMainnetBeta` was requested. |
| `SOLANA_NUMERAIRE_UNSUPPORTED` | `422` | The numeraire is not WSOL. |
| `SOLANA_NUMERAIRE_PRICE_REQUIRED` | `422` | No request override, configured fixed price, or provider price is available. |
| `SOLANA_INVALID_ADDRESS` | `422` | A Solana address is malformed. |
| `SOLANA_INVALID_METADATA` | `422` | Token metadata is invalid. |
| `SOLANA_INVALID_ECONOMICS` | `422` | Supply, reserve, or migration economics are invalid. |
| `SOLANA_INVALID_CURVE` | `422` | The XYK curve configuration or derived curve is invalid. |
| `SOLANA_INVALID_FEE_BENEFICIARIES` | `422` | Beneficiaries or `shareBps` values are invalid. |
| `SOLANA_NOT_READY` | `503` | A readiness gate failed before creation. |
| `SOLANA_SIMULATION_FAILED` | `422` or `502` | The program rejected the transaction (`422`) or the simulation RPC failed (`502`). |
| `SOLANA_SUBMISSION_FAILED` | `500` or `502` | Local transaction assembly/signing failed (`500`) or submission/confirmation failed (`502`). |
| `SOLANA_LOOKUP_FAILED` | `502` | The launch account lookup failed. |
| `SOLANA_LAUNCH_NOT_FOUND` | `404` | The requested launch account does not exist. |

Solana `feeBeneficiaries` uses `shareBps` and is independent of the EVM beneficiary fields.

### Pricing

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_PRICE_OVERRIDE` | `422` | The supplied USD price is not positive and finite. |
| `PRICE_REQUIRED` | `422` | Automatic pricing is unavailable and no override was supplied. |
| `PRICE_UNSUPPORTED_NUMERAIRE` | `422` | Automatic pricing does not support the requested numeraire. |
| `PRICE_UPSTREAM_ERROR` | `502` | The price provider returned an unsuccessful response. |
| `PRICE_UPSTREAM_INVALID` | `502` | The price provider returned an invalid price. |
| `PRICE_FETCH_FAILED` | `502` | The price provider request failed. |

### Launch status and chain resolution

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_LAUNCH_ID` | `422` | An EVM launch ID is not formatted as `<chainId>:<txHash>`. |
| `CHAIN_ID_REQUIRED` | `422` | An EVM request omitted `chainId` and no `DEFAULT_CHAIN_ID` is configured. |
| `CHAIN_NOT_CONFIGURED` | `422` | The selected chain does not have its named RPC configured. |
| `CHAIN_LOOKUP_FAILED` | `502` | A chain transaction or receipt lookup failed. |
| `CREATE_EVENT_NOT_FOUND` | `502` | The create transaction did not contain the expected event. |
| `CREATE_TX_DECODE_FAILED` | `502` | The create transaction input could not be decoded. |

### Idempotency

| Code | Status | Meaning |
| --- | --- | --- |
| `IDEMPOTENCY_KEY_REQUIRED` | `422` | The deployment requires a key for create requests. |
| `IDEMPOTENCY_KEY_REUSE_MISMATCH` | `409` | The key was previously used with a different payload. |
| `IDEMPOTENCY_KEY_IN_DOUBT` | `409` | An earlier request may have submitted a transaction and cannot be replayed safely. |
| `IDEMPOTENCY_STORE_CORRUPT` | `500` | A persisted idempotency record cannot be read safely. |
| `NONCE_LOCK_LOST` | `503` | Distributed nonce-lock ownership was lost before broadcast. |

A completed request made again with the same key and payload returns the stored response before current request validation. This also permits an exact retry of a historical request that no longer matches the current schema. Reusing the key with a different payload returns `IDEMPOTENCY_KEY_REUSE_MISMATCH`.

When an EVM broadcast result is ambiguous, `IDEMPOTENCY_KEY_IN_DOUBT` includes `chainId`, `accountAddress`, and `nonce`. Reconcile that account and nonce before submitting another transaction. When Solana submission succeeds but confirmation remains ambiguous, the error includes `launchId`, `signature`, and `explorerUrl`; use those values to reconcile the submitted transaction. If a completed response cannot be durably persisted, the error instead preserves the completed response identifiers: `launchId`, `chainId`, `txHash`, and `statusUrl` for EVM, or `launchId`, `network`, `signature`, `explorerUrl`, and `statusUrl` for Solana. Retries with the same key continue to return the same details and fail closed while the in-doubt record exists.

Deterministic wallet and provider rejections are not persisted as in doubt. `NONCE_LOCK_LOST` occurs before broadcast, so the identical request may be retried with the same idempotency key.

### Service configuration

| Code                | Status | Meaning                                                           |
| ------------------- | ------ | ----------------------------------------------------------------- |
| `MISSING_ENV`       | `500`  | A required environment variable or runtime dependency is missing. |
| `INVALID_ENV`       | `500`  | Service configuration is invalid.                                 |
| `REDIS_UNAVAILABLE` | `500`  | Redis could not be reached during startup.                        |

## Operational behavior

- `GET /ready` replaces dependency failure details with `"dependency unavailable"`.
- Shared deployments require Redis-backed idempotency, Redis-backed rate limiting, reachable Redis at startup, and idempotency keys on create requests.
- Standalone deployments may disable idempotency.
