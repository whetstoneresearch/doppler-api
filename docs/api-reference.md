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
- `feeBeneficiaries?: [{ address, shareBps }]`
- `governance?: false`
- `migration?: { type: "none", supportCpmm?: boolean, minimumQuoteRaise?: string }`
- `auction:`
  - `type: "xyk"`
  - `curveConfig: { type: "range", marketCapStartUsd, marketCapEndUsd }`
  - `swapFeeBps?: number` preferred; `curveFeeBps?: number` is a backward-compatible alias
  - `allowBuy?: boolean`
  - `allowSell?: boolean`
  - `dynamicFee?: { startingTime?: string, startFeeBps, endFeeBps, durationSeconds: string }`
  - `cosignerGate?: { type: "cosigner", cosigner, expiry? }`

#### Solana request constraints

- Solana create responses include `statusUrl` for `GET /v1/solana/launches/:launchAddress`.
- `solanaMainnetBeta` is scaffolded but returns `501 SOLANA_NETWORK_UNSUPPORTED`.
- WSOL is the only supported numeraire.
- `migration.supportCpmm=true` registers the launch with the CPMM migrator. All API-created launches use the CPMM hook; migration registration and hook features are independent.
- `migration.minimumQuoteRaise` is required when `migration.supportCpmm=true` and is denominated in quote token atoms.
- `economics.baseForDistribution` and `economics.baseForLiquidity` must be omitted or `0` unless `migration.supportCpmm=true`.
- Non-zero reserve fields return `422 SOLANA_INVALID_ECONOMICS` unless CPMM migration support is enabled.
- `auction.cosignerGate` configures cosigner gating through the CPMM hook, with or without CPMM migration. It requires `type: "cosigner"` and a Solana `cosigner` address. Optional `expiry.mode` supports `disabled`, `unixTimestamp`, and `slot`; omitted or `disabled` expiry is indefinite, while timestamp and slot modes require `expiry.value`.
- `auction.dynamicFee` configures a fee schedule on the CPMM hook. `startFeeBps` and `endFeeBps` are basis points, `durationSeconds` is a non-negative integer string, and optional `startingTime` defaults to launch creation when omitted or `"0"`. The effective swap fee is `max(dynamicFee, swapFeeBps)`.
- `auction.dynamicFee` can be combined with `auction.cosignerGate` to enable both features on the same hook.
- `feeBeneficiaries` supports up to 8 unique Solana addresses, uses `shareBps`, and custom shares must sum to `10000`. If the API payer is the initializer protocol beneficiary, provide a non-protocol beneficiary list.
- Unsupported fields are rejected instead of ignored, including:
  - `economics.tokensForSale`
  - allocations / vesting fields
  - prediction-market fields
  - `governance !== false`
  - `migration.type !== "none"`
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
- `predicted: { tokenAddress, launchAuthorityAddress, launchFeeStateAddress, baseVaultAddress, quoteVaultAddress }`
- `effectiveConfig: { tokensForSale, allocationAmount, baseForDistribution, baseForLiquidity, allocationLockMode, numeraireAddress, numerairePriceUsd, curveVirtualBase, curveVirtualQuote, curveFeeBps, swapFeeBps, feeBeneficiariesSource, feeBeneficiaries, allowBuy, allowSell, tokenDecimals }`
- `tokenDecimals` is fixed to `6` for Solana base tokens.

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
- `feeBeneficiaries?: [{ address, shareBps }]`
- `governance?: false`
- `migration?: { type: "none", supportCpmm?: boolean, minimumQuoteRaise?: string }`
- `auction: { type: "xyk", curveConfig: { type: "range", marketCapStartUsd, marketCapEndUsd }, swapFeeBps?, curveFeeBps?, allowBuy?, allowSell? }`

#### Response `200`

- `launchId` is the base58 launch PDA
- `statusUrl` points to `GET /v1/solana/launches/:launchAddress`
- response shape matches the Solana response described on `POST /v1/launches`

#### Create-time Solana validation

- `solanaMainnetBeta` -> `501 SOLANA_NETWORK_UNSUPPORTED`
- non-WSOL numeraire -> `422 SOLANA_NUMERAIRE_UNSUPPORTED`
- missing price after request/env/provider resolution -> `422 SOLANA_NUMERAIRE_PRICE_REQUIRED`
- invalid metadata -> `422 SOLANA_INVALID_METADATA`
- invalid economics or unsupported reserves -> `422 SOLANA_INVALID_ECONOMICS`
- invalid market-cap range or fee input -> `422 SOLANA_INVALID_CURVE`
- invalid fee beneficiaries -> `422 SOLANA_INVALID_FEE_BENEFICIARIES`
- readiness failure -> `503 SOLANA_NOT_READY`
- simulation failure -> `422 SOLANA_SIMULATION_FAILED`
- submission failure -> `502 SOLANA_SUBMISSION_FAILED`
- ambiguous confirmation -> `409 IDEMPOTENCY_KEY_IN_DOUBT`

---

### `GET /v1/solana/launches/:launchAddress`

Returns devnet Solana launch account state.

#### Path param

- `launchAddress`: base58 launch PDA

#### Response `200`

- `network = "solanaDevnet"`
- `launchAddress`
- `phase: { code, label }`
- launch authority, namespace, mint, and vault addresses
- supply split fields: `baseTotalSupply`, `baseForDistribution`, `baseForLiquidity`, `baseForCurve`
- curve fields: `curveVirtualBase`, `curveVirtualQuote`, `curveFeeBps`, `swapFeeBps`, `allowBuy`, `allowSell`
- hook/migrator fields: `hookProgram`, `hookFlags`, `migratorProgram`, `quoteDeposited`
- `tokenDecimals` is fixed to `6` for Solana base tokens.

#### Error responses

- `404 SOLANA_LAUNCH_NOT_FOUND`
- `422 SOLANA_INVALID_ADDRESS`
- `501 SOLANA_NETWORK_UNSUPPORTED` when Solana is disabled
- `502 SOLANA_LOOKUP_FAILED`

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
- configured devnet address lookup table presence when `SOLANA_DEVNET_ALT_ADDRESS` is set
