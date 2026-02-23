# API Reference

Base URL (local): `http://localhost:3000`

## Authentication

- Required on:
  - `POST /v1/launches`
  - `POST /v1/launches/multicurve`
  - `GET /v1/launches/:launchId`
- Header:
  - `x-api-key: <API_KEY>`
- Not required on:
  - `GET /health`
  - `GET /ready`
  - `GET /v1/capabilities`
  - `GET /metrics`

## Implemented endpoints

### `POST /v1/launches`

Generic launch creation endpoint (future-compatible).

- v1 implementation supports:
  - `auction.type = "multicurve"`
  - `migration.type = "noOp"`
  - `governance: false` (or omitted) for no-op governance
  - non-no-op governance is not implemented in this deployment

#### Request body

- `chainId?: number` (defaults to configured chain)
- `userAddress: 0x...`
- `integrationAddress?: 0x...`
- `tokenMetadata: { name, symbol, tokenURI }`
- `tokenomics: { totalSupply, tokensForSale?, allocations? }`
  - `tokensForSale` defaults to `totalSupply` when omitted.
  - when `tokensForSale < totalSupply`, market allocation must be at least `20%` of `totalSupply`.
  - `allocations` is optional metadata for lock behavior when `tokensForSale < totalSupply`:
    - `recipientAddress?` (defaults to `userAddress`)
    - `recipients?: [{ address, amount }]` (preferred)
    - `allocations?: [{ address, amount }]` (legacy alias)
      - optional explicit recipient split for non-market allocation remainder
      - supports up to `10` unique addresses, no duplicates
      - must sum exactly to `totalSupply - tokensForSale`
      - if provided and `tokensForSale` is omitted, API derives `tokensForSale` from:
        `totalSupply - sum(recipients[].amount)`
    - `mode?` (`vest` | `unlock` | `vault`, default `vest`)
    - `durationSeconds?` (default `7776000` for `vest`/`vault`)
    - `cliffDurationSeconds?` (must be `<= durationSeconds`)
- `pairing?: { numeraireAddress? }`
- `pricing?: { numerairePriceUsd? }`
- `feeBeneficiaries?: [{ address, sharesWad }]`
- `governance?: boolean | { enabled, mode? }`
  - `true` => currently unsupported (returns `501 GOVERNANCE_NOT_IMPLEMENTED`)
  - `false` or omitted => no-op governance
- `migration: { type }`
- `auction:`
  - `type: "multicurve"`:
    - `curveConfig.type = "preset"`:
      - `presets?: ("low"|"medium"|"high")[]`
      - `fee?: number`
      - `tickSpacing?: number`
    - `curveConfig.type = "ranges"`:
      - `fee?: number`
      - `tickSpacing?: number`
      - `curves: [{ marketCapStartUsd, marketCapEndUsd, numPositions, sharesWad }]`
      - `marketCapEndUsd` accepts positive number or `"max"` in API payloads

#### Response `200`

- `launchId`, `chainId`, `txHash`, `statusUrl`
- `predicted: { tokenAddress, poolId, gasEstimate? }`
- `effectiveConfig: { tokensForSale, allocationAmount, allocationRecipient, allocationRecipients?, allocationLockMode, allocationLockDurationSeconds, numeraireAddress, numerairePriceUsd, feeBeneficiariesSource }`

#### Idempotency header

- Optional request header: `Idempotency-Key: <string>`
- same key + same request payload: returns original response and sets `x-idempotency-replayed: true`
- same key + different payload: returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`
- when `IDEMPOTENCY_REQUIRE_KEY=true`, create requests without header return `422 IDEMPOTENCY_KEY_REQUIRED`

#### Error responses

- `401 UNAUTHORIZED`
- `422 INVALID_REQUEST` (schema validation) and domain-specific validation errors
- `501 AUCTION_NOT_IMPLEMENTED` for `static`/`dynamic`
- `501 MIGRATION_NOT_IMPLEMENTED` for `uniswapV2`/`uniswapV4`
- `501 GOVERNANCE_NOT_IMPLEMENTED` for non-no-op governance (`governance: true` or `governance.mode != "noOp"`)

---

### `POST /v1/launches/multicurve`

Convenience alias for multicurve launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "multicurve"`.
- Same auth, request shape, response, and error model as `POST /v1/launches`.

---

### `GET /v1/launches/:launchId`

Returns current launch transaction status.

#### Path param

- `launchId: "<chainId>:<txHash>"`

#### Response `200`

- `status = "pending" | "confirmed" | "reverted" | "not_found"`
- includes `confirmations`
- `result` included when confirmed:
  - `tokenAddress`
  - `poolOrHookAddress`
  - `poolId`
  - `blockNumber`
- `error` included when reverted

#### Error responses

- `401 UNAUTHORIZED`
- `422 INVALID_LAUNCH_ID`
- `502 CHAIN_LOOKUP_FAILED`
- `502 CREATE_EVENT_NOT_FOUND`
- `500 INTERNAL_ERROR` (unexpected)

---

### `GET /v1/capabilities`

Returns deployment profile and per-chain capability matrix.
Current v1 governance capabilities are `governanceModes: ["noOp"]` and `governanceEnabled: false`.

#### Response `200`

- `defaultChainId`
- `pricing: { enabled, provider }`
- `chains[]`:
  - `chainId`
  - `auctionTypes`
  - `migrationModes`
  - `governanceModes`
  - `governanceEnabled`

---

### `GET /health`

Liveness probe.

#### Response `200`

```json
{ "status": "ok" }
```

---

### `GET /ready`

Dependency readiness probe (RPC checks for configured chains).

#### Response

- `200` when all chains are reachable
- `503` when any chain check fails
- body:
  - `status: "ready" | "degraded"`
  - `checks[]: { chainId, ok, latestBlock? , error? }`

---

### `GET /metrics`

Basic service metrics snapshot for operational visibility.

#### Response `200`

- `startedAt`
- `uptimeSec`
- `http.totalRequests`
- `http.byStatusClass`
- `http.avgDurationMs`

## Request/response examples

See:

- `README.md` for quick examples
- `docs/custom-curves.md` for detailed multicurve payloads
- `docs/openapi.yaml` for machine-readable schemas
