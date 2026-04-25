# API Reference

Base URL (local): `http://localhost:3000`

## Authentication

- Required on:
  - `POST /v1/launches`
  - `POST /v1/solana/launches`
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
- `GET /health` is rate-limited by client IP.
- For all `5xx` responses, `message` is intentionally generic (`"Internal server error"`).

## Implemented endpoints

### `POST /v1/launches`

Generic create endpoint.

- Solana requests are dispatched only when `network` is one of:
  - `solanaDevnet`
  - `solanaMainnetBeta`
- Short Solana aliases (`devnet`, `mainnet-beta`) are rejected on this route.

#### EVM request shape

- `chainId?: number`
- `userAddress: 0x...`
- `integrationAddress?: 0x...`
- `tokenMetadata: { name, symbol, tokenURI }`
- `economics: { totalSupply, tokensForSale?, allocations? }`
- `pairing?: { numeraireAddress? }`
- `pricing?: { numerairePriceUsd? }`
- `feeBeneficiaries?: [{ address, sharesWad }]`
- `governance?: boolean | { enabled, mode? }`
- `migration: { type: "noOp" | "uniswapV2" | "uniswapV3" } | { type: "uniswapV4", fee, tickSpacing }`
- `auction.type: "multicurve" | "static" | "dynamic"`
- `auction:` network-specific config for the selected `auction.type`

#### Solana request shape on the generic route

- `network: "solanaDevnet" | "solanaMainnetBeta"`
- `tokenMetadata: { name, symbol, tokenURI }`
- `economics: { totalSupply, baseForDistribution?, baseForLiquidity? }`
- `pairing?: { numeraireAddress? }`
- `pricing?: { numerairePriceUsd? }`
- `governance?: false`
- `migration?: { type: "noOp" }`
- `auction:`
  - `type: "xyk"`
  - `curveConfig: { type: "range", marketCapStartUsd, marketCapEndUsd }`
  - `curveFeeBps?: number`
  - `allowBuy?: boolean`
  - `allowSell?: boolean`

#### Solana request constraints

- Solana create endpoints do not expose a status route.
- `solanaMainnetBeta` is scaffolded but returns `501 SOLANA_NETWORK_UNSUPPORTED`.
- WSOL is the only supported numeraire.
- `economics.baseForDistribution` and `economics.baseForLiquidity` default to `0`.
- `economics.baseForDistribution + economics.baseForLiquidity` must be less than `economics.totalSupply`.
- Unsupported fields are rejected instead of ignored, including:
  - `economics.tokensForSale`
  - allocations / vesting fields
  - fee beneficiaries
  - prediction-market fields
  - `governance !== false`
  - `migration.type !== "noOp"`
  - non-`xyk` auction payloads

#### Response `200`

EVM response:

- `launchId`, `chainId`, `txHash`, `statusUrl`
- `predicted: { tokenAddress, poolId, gasEstimate? }`
- `effectiveConfig: { tokensForSale, allocationAmount, allocationRecipient, allocationRecipients?, allocationLockMode, allocationLockDurationSeconds, numeraireAddress, numerairePriceUsd, feeBeneficiariesSource, initializer? }`

Solana response:

- `launchId`
- `network`
- `signature`
- `explorerUrl`
- `predicted: { tokenAddress, launchAuthorityAddress, baseVaultAddress, quoteVaultAddress }`
- `effectiveConfig: { tokensForSale, allocationAmount, baseForDistribution, baseForLiquidity, allocationLockMode, numeraireAddress, numerairePriceUsd, curveVirtualBase, curveVirtualQuote, curveFeeBps, allowBuy, allowSell, tokenDecimals }`

#### Idempotency header

- Request header: `Idempotency-Key: <string>`
  - optional in standalone mode
  - required in shared mode
- same key + same request payload: returns original response and sets `x-idempotency-replayed: true`
- same key + different payload: returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`
- EVM crash-window retries can return `409 IDEMPOTENCY_KEY_IN_DOUBT`
- Solana ambiguous confirmation retries can return `409 IDEMPOTENCY_KEY_IN_DOUBT`

#### Error responses

- `401 UNAUTHORIZED`
- `429 RATE_LIMITED`
- `422 INVALID_REQUEST` plus domain-specific `422` Solana or EVM validation failures
- `409 IDEMPOTENCY_KEY_IN_DOUBT`
- `501 MIGRATION_NOT_IMPLEMENTED`
- `501 SOLANA_NETWORK_UNSUPPORTED`
- `502 SOLANA_SUBMISSION_FAILED`
- `503 SOLANA_NOT_READY`
- `500 INTERNAL_ERROR`

---

### `POST /v1/solana/launches`

Dedicated Solana create endpoint.

#### Request body

- `network?: "devnet" | "mainnet-beta"`
  - omitted uses `SOLANA_DEFAULT_NETWORK`
  - `devnet` normalizes to `solanaDevnet`
  - `mainnet-beta` normalizes to `solanaMainnetBeta`
- `tokenMetadata: { name, symbol, tokenURI }`
- `economics: { totalSupply, baseForDistribution?, baseForLiquidity? }`
- `pairing?: { numeraireAddress? }`
- `pricing?: { numerairePriceUsd? }`
- `governance?: false`
- `migration?: { type: "noOp" }`
- `auction: { type: "xyk", curveConfig: { type: "range", marketCapStartUsd, marketCapEndUsd }, curveFeeBps?, allowBuy?, allowSell? }`

#### Response `200`

- `launchId` is the base58 launch PDA
- no `statusUrl` is returned
- response shape matches the Solana response described on `POST /v1/launches`

#### Create-time Solana validation

- `solanaMainnetBeta` -> `501 SOLANA_NETWORK_UNSUPPORTED`
- non-WSOL numeraire -> `422 SOLANA_NUMERAIRE_UNSUPPORTED`
- missing price after request/env/provider resolution -> `422 SOLANA_NUMERAIRE_PRICE_REQUIRED`
- invalid metadata -> `422 SOLANA_INVALID_METADATA`
- invalid market-cap range or fee input -> `422 SOLANA_INVALID_CURVE`
- readiness failure -> `503 SOLANA_NOT_READY`
- simulation failure -> `422 SOLANA_SIMULATION_FAILED`
- submission failure -> `502 SOLANA_SUBMISSION_FAILED`
- ambiguous confirmation -> `409 IDEMPOTENCY_KEY_IN_DOUBT`

---

### `POST /v1/launches/multicurve`

Convenience alias for EVM multicurve launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "multicurve"`.
- Solana is not supported on this alias route.

---

### `POST /v1/launches/static`

Convenience alias for EVM static launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "static"`.
- Solana is not supported on this alias route.

---

### `POST /v1/launches/dynamic`

Convenience alias for EVM dynamic launches.

- Internally forwards to `POST /v1/launches` and forces `auction.type = "dynamic"`.
- Solana is not supported on this alias route.

---

### `GET /v1/launches/:launchId`

Returns current launch transaction status for EVM launches only.

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
- `500 INTERNAL_ERROR`

---

### `GET /v1/capabilities`

Returns deployment profile and supported create capabilities.

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
- `solana`:
  - `enabled`
  - `supportedNetworks`
  - `unsupportedNetworks`
  - `dedicatedRouteInputAliases`
  - `creationOnly`
  - `numeraireAddress`
  - `priceResolutionModes`

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

Dependency readiness probe.

#### Response

- `200` when all configured EVM chain checks and Solana readiness checks pass
- `503` when any check fails
- body:
  - `status: "ready" | "degraded"`
  - `checks[]` for configured EVM chains
  - `solana: { enabled, ok, network?, checks[] }`

#### Solana readiness checks

- RPC reachable
- latest blockhash fetch
- initializer config account decode
- address lookup table presence when ALT is enabled
