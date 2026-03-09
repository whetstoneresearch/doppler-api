# API Reference

Base URL (local): `http://localhost:3000`

## Authentication

- Required on:
  - `POST /v1/launches`
  - `POST /v1/launches/multicurve`
  - `POST /v1/launches/static`
  - `POST /v1/launches/dynamic`
  - `GET /v1/launches/:launchId`
  - `GET /v1/capabilities`
  - `GET /ready`
  - `GET /metrics`
- Header:
  - `x-api-key: <API_KEY>`
- Not required on:
  - `GET /health`

## Error behavior

- Error envelope shape: `{ error: { code, message, details? } }`
- Rate limiting returns `429 RATE_LIMITED`.
- `GET /health` is rate-limited by client IP (spoofed `x-api-key` values are ignored for bucketing).
- For all `5xx` responses, `message` is intentionally generic (`"Internal server error"`);
  use server logs plus `x-request-id` for diagnostics.

## Implemented endpoints

### `POST /v1/launches`

Generic launch creation endpoint (future-compatible).

- v1 implementation supports:
  - `auction.type = "multicurve"` (preferred on V4-capable networks)
  - `auction.type = "dynamic"` (for high value assets requiring maximally capital-efficient price discovery)
  - `auction.type = "static"` (Uniswap V3 static launch; fallback for networks without Uniswap V4 support)
  - `migration.type = "noOp"` for multicurve/static
  - `migration.type = "uniswapV2"` and `migration.type = "uniswapV4"` for dynamic
  - `migration.type = "uniswapV3"` is explicitly unsupported (returns `501 MIGRATION_NOT_IMPLEMENTED`)
  - `governance: false` (or omitted) for no governance
  - `governance: true` (or `{ enabled: true }`) for default token-holder governance (OpenZeppelin Governor)

#### Request body

- `chainId?: number` (defaults to configured chain)
- `userAddress: 0x...`
- `integrationAddress?: 0x...`
- `tokenMetadata: { name, symbol, tokenURI }`
- `economics: { totalSupply, tokensForSale?, allocations? }`
  - `tokensForSale` defaults to `totalSupply` when omitted.
  - when `tokensForSale < totalSupply`, market allocation must be at least `20%` of `totalSupply`.
  - `allocations` is optional metadata for lock behavior when `tokensForSale < totalSupply`:
    - `recipientAddress?` (defaults to `userAddress`)
    - `recipients?: [{ address, amount }]`
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
  - supports up to `10` unique addresses
  - when protocol owner is included, shares must sum to `1e18` and protocol owner must have at least `5%` (`WAD / 20`)
  - when protocol owner is omitted, request shares must sum to `0.95e18` and API appends protocol owner at `0.05e18`
- `governance?: boolean | { enabled, mode? }`
  - `true` or `{ enabled: true }` => default token-holder governance (OpenZeppelin Governor)
  - `false` or omitted => no governance
  - when `mode` is provided it must match the binary value (`default` for enabled, `noOp` for disabled)
  - default governance is provisioned via the protocol governance factory.
- `migration:`
  - `{ type: "noOp" | "uniswapV2" | "uniswapV3" }`
  - `{ type: "uniswapV4", fee, tickSpacing }` (required for dynamic V4 migration)
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
      - example explicit first band: `marketCapStartUsd: 100`
    - custom multicurve fees are supported via `curveConfig.fee`
    - `initializer?`:
      - `{ type: "standard" }` (implemented via scheduled initializer at startTime `0`)
      - `{ type: "scheduled", startTime }`
      - `{ type: "decay", startFee, durationSeconds, startTime? }`
      - `{ type: "rehype", config: { hookAddress, buybackDestination, customFee, assetBuybackPercentWad, numeraireBuybackPercentWad, beneficiaryPercentWad, lpPercentWad, graduationCalldata?, graduationMarketCap?, numerairePrice?, farTick? } }`
  - `type: "static"`:
    - `curveConfig.type = "preset"`:
      - `preset: ("low"|"medium"|"high")`
      - `fee?: number`
      - `numPositions?: number`
      - `maxShareToBeSoldWad?: string`
    - `curveConfig.type = "range"`:
      - `marketCapStartUsd: number`
      - `marketCapEndUsd: number`
      - `fee?: number`
      - `numPositions?: number`
      - `maxShareToBeSoldWad?: string`
      - example range start: `marketCapStartUsd: 100`
      - custom static fee input is supported via `curveConfig.fee` (must still be a valid Uniswap V3 fee tier onchain)
    - static launches are configured with lockable beneficiaries (request values or default split)
    - static is intended for chains that do not support Uniswap V4 multicurve paths
  - `type: "dynamic"`:
    - intended for assets with well-known value that need maximally capital-efficient price discovery
    - `curveConfig.type = "range"`:
      - `marketCapStartUsd: number` (starting market cap in USD)
      - `marketCapMinUsd: number` (minimum market cap floor in USD, must be lower than start)
      - `minProceeds: string` (decimal string in numeraire units, e.g. `"0.01"`)
      - `maxProceeds: string` (decimal string in numeraire units, e.g. `"0.1"`)
      - optional: `durationSeconds`, `epochLengthSeconds`, `fee`, `tickSpacing`, `gamma`, `numPdSlugs`
      - custom dynamic fees are supported via `curveConfig.fee`
    - migration policy:
      - dynamic requires `migration.type = "uniswapV2"` or `migration.type = "uniswapV4"`
      - `migration.type = "uniswapV4"` requires `migration.fee` and `migration.tickSpacing`
      - `migration.type = "uniswapV4"` derives streamable fee beneficiaries from `feeBeneficiaries` (or default 95/5)
      - `migration.type = "uniswapV3"` is reserved and currently returns `501 MIGRATION_NOT_IMPLEMENTED`
    - exit/migration behavior:
      - migrate immediately when `maxProceeds` is reached
      - otherwise migrate at auction maturity only if `minProceeds` is reached

#### Response `200`

- `launchId`, `chainId`, `txHash`, `statusUrl`
- `predicted: { tokenAddress, poolId, gasEstimate? }`
- `effectiveConfig: { tokensForSale, allocationAmount, allocationRecipient, allocationRecipients?, allocationLockMode, allocationLockDurationSeconds, numeraireAddress, numerairePriceUsd, feeBeneficiariesSource, initializer? }`

#### Idempotency header

- Request header: `Idempotency-Key: <string>`
  - optional in local mode
  - required in shared/prod mode
- same key + same request payload: returns original response and sets `x-idempotency-replayed: true`
- same key + different payload: returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`
- when `IDEMPOTENCY_REQUIRE_KEY=true` (always true in shared mode), create requests without header return `422 IDEMPOTENCY_KEY_REQUIRED`

#### Error responses

- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`
- `422 INVALID_REQUEST` (schema validation) and domain-specific validation errors
- `501 MIGRATION_NOT_IMPLEMENTED` for unsupported migration modes (for example `uniswapV3`)
- `500 INTERNAL_ERROR` (message is generic)

---

### `POST /v1/launches/multicurve`

Convenience alias for multicurve launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "multicurve"`.
- Same auth, request shape, response, and error model as `POST /v1/launches`.

---

### `POST /v1/launches/static`

Convenience alias for static launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "static"`.
- Same auth, request shape, response, and error model as `POST /v1/launches`.

---

### `POST /v1/launches/dynamic`

Convenience alias for dynamic launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "dynamic"`.
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
- `429 RATE_LIMITED`
- `422 INVALID_LAUNCH_ID`
- `502 CHAIN_LOOKUP_FAILED`
- `502 CREATE_EVENT_NOT_FOUND`
- `500 INTERNAL_ERROR` (message is generic)

---

### `GET /v1/capabilities`

Returns deployment profile and per-chain capability matrix.
Governance support is chain-specific. Check `governanceModes` and `governanceEnabled` per chain.

#### Response `200`

- `defaultChainId`
- `pricing: { enabled, provider }`
- `chains[]`:
  - `chainId`
  - `auctionTypes`
  - `multicurveInitializers`
  - `migrationModes`
  - `governanceModes`
  - `governanceEnabled`

#### Error responses

- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`

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
  - when `ok=false`, `error` is intentionally generic (`"dependency unavailable"`)

#### Error responses

- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`

---

### `GET /metrics`

Basic service metrics snapshot for operational visibility.

#### Response `200`

- `startedAt`
- `uptimeSec`
- `http.totalRequests`
- `http.byStatusClass`
- `http.avgDurationMs`

#### Error responses

- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`

## Request/response examples

See:

- `README.md` for quick examples
- `docs/custom-curves.md` for detailed multicurve payloads
- `docs/openapi.yaml` for machine-readable schemas
