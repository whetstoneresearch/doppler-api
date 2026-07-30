# API Reference

The service accepts and returns JSON. The OpenAPI 3.1 contract is available at [`docs/openapi.yaml`](openapi.yaml).

## Route summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/launches` | Shared EVM launch route for static, multicurve, and dynamic auctions. It also accepts the shared-route Solana request shape. |
| `POST` | `/v1/launches/static` | Family-specific route for static EVM auctions. |
| `POST` | `/v1/launches/multicurve` | Family-specific route for multicurve EVM auctions. |
| `POST` | `/v1/launches/dynamic` | Family-specific route for dynamic EVM auctions. |
| `POST` | `/v1/solana/launches` | Dedicated Solana create route. |
| `GET` | `/v1/launches/:launchId` | EVM launch transaction status. |
| `GET` | `/v1/solana/launches/:launchAddress` | Solana launch account state. |
| `GET` | `/v1/capabilities` | Enabled chains, modes, pricing, and Solana availability. |
| `GET` | `/health` | Process liveness. |
| `GET` | `/ready` | EVM and Solana dependency readiness. |
| `GET` | `/metrics` | In-process HTTP metrics. |

## Authentication, rate limits, and retries

Send `x-api-key` on every endpoint except `GET /health`. A missing or invalid key returns `401 UNAUTHORIZED`. Rate limiting applies to every endpoint; an exceeded limit returns `429`.

Every create route accepts `Idempotency-Key`. It is optional in standalone deployments and required in shared deployments. Reuse a key only with the exact same request body:

- A completed request is returned again with `X-Idempotency-Replayed: true`. Replay happens before current schema validation, so an exact historical body remains replayable after a contract change.
- Reusing a key with a different body returns `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`.
- `409 IDEMPOTENCY_KEY_IN_DOUBT` means submission may have succeeded. Reconcile the recorded EVM signer and nonce, Solana signature, or returned launch and transaction identifiers before using a new key. Ambiguous submissions are not automatically resubmitted.

A confirmed pre-broadcast EVM token-address collision returns `409 TOKEN_ADDRESS_COLLISION`. Pending chain state participates in collision and simulation checks.

## Errors

Errors use one envelope:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Request failed validation",
    "details": {}
  }
}
```

`details` is optional. Validation failures and unknown keys in strict request objects return `422`; Zod validation failures use `INVALID_REQUEST`. Server errors return the public message `Internal server error` and omit internal details.

| HTTP status | Meaning |
| --- | --- |
| `401` | Missing or invalid API key. |
| `404` | A requested Solana launch account does not exist. |
| `409` | Idempotency conflict, uncertain submission, or token-address collision. |
| `422` | Invalid fields, invalid field combinations, unavailable request default, or a mode not enabled for the selected chain. |
| `429` | Rate limit exceeded. |
| `501` | Solana is disabled or the recognized Mainnet Beta network is not executable. |
| `502` | Chain lookup, simulation, submission, or response decoding failed. |
| `503` | A required dependency is unavailable or an EVM nonce lock was lost before broadcast. |

## EVM create routes

### Route selection

`POST /v1/launches` accepts every EVM auction family. The three family-specific routes accept the same family schema but require their matching `auction.type`:

- `/v1/launches/static` requires `"static"`;
- `/v1/launches/multicurve` requires `"multicurve"`;
- `/v1/launches/dynamic` requires `"dynamic"`.

All four routes return the same EVM create response. EVM request objects are strict: Solana-only `feeBeneficiaries`, unknown top-level keys, and unknown nested keys return `422 INVALID_REQUEST`.

### Common EVM request fields

| Field | Required | Type and behavior |
| --- | --- | --- |
| `chainId` | Conditional | Integer chain ID. Supported IDs are `1`, `143`, `4663`, `8453`, and `84532`. Omission uses `DEFAULT_CHAIN_ID`; without a configured default it returns `422 CHAIN_ID_REQUIRED`. An explicitly selected supported chain without its named RPC returns `422 CHAIN_NOT_CONFIGURED`; there is no fallback to another chain. |
| `userAddress` | Yes | Non-zero EVM address that owns the launch. |
| `integrationAddress` | No | Non-zero EVM integrator address. |
| `tokenMetadata` | Yes | Token identity and optional balance-limit controls described below. |
| `economics` | Yes | Supply and optional vesting allocations described below. |
| `pairing.numeraireAddress` | No | EVM address. Defaults to the chain's configured numeraire and then its WETH address. If neither exists, the request returns `422 NUMERAIRE_REQUIRED`. |
| `pricing.numerairePriceUsd` | No | Positive number overriding numeraire USD pricing. Otherwise the configured pricing source resolves the price. |
| `poolFeeBeneficiaries` | No | Up to 10 pool-fee recipients. It is not accepted with dynamic `uniswapV2`. |
| `governance` | No | `false`, `true`, or a non-zero EVM multisig address. See governance below. |
| `auction` | Yes | Static, multicurve, or dynamic family object. |
| `migration` | Dynamic only | Exactly one `uniswapV2` or `uniswapV4` migration. Static and multicurve requests reject it. |

#### `tokenMetadata`

| Field | Required | Validation and default |
| --- | --- | --- |
| `name` | Yes | Non-empty string. |
| `symbol` | Yes | Non-empty string. |
| `tokenURI` | Yes | Non-empty string. |
| `maxBalanceLimit` | No | Positive decimal integer string. It must be lower than `economics.totalSupply` and must appear with `balanceLimitEnd`. |
| `balanceLimitEnd` | No | Future Unix timestamp from `0` through `281474976710655`; it must appear with `maxBalanceLimit`. |
| `balanceController` | No | Non-zero EVM address. |
| `excludedFromBalanceLimit` | No | Case-insensitively unique EVM addresses. A non-empty list requires `maxBalanceLimit` and `balanceLimitEnd`. |

EVM launches use `DopplerERC20V1`. Supplying only one of the two balance-limit fields, a zero limit, an expired end time, or exclusions without an active limit returns `422`. `maxBalanceLimit`, `totalSupply`, `tokensForSale`, each allocation `amount`, and each pool-beneficiary `sharesWad` are canonical positive values encoded as decimal strings without leading zeros. Contract-sized values cannot exceed `115792089237316195423570985008687907853269984665640564039457584007913129639935` ($2^{256}-1$).

#### `economics`

| Field | Required | Validation and default |
| --- | --- | --- |
| `totalSupply` | Yes | Positive decimal integer string. |
| `tokensForSale` | No | Positive decimal integer string no greater than `totalSupply`. With no allocations it defaults to `totalSupply`; with explicit allocations it defaults to `totalSupply` minus their sum. If lower than total supply, it must be at least 20% of total supply. |
| `allocations` | No | From 1 through 10 independent vesting schedules. Their amounts must equal `totalSupply - tokensForSale`. The same recipient may appear more than once. |

Each allocation contains:

| Field                  | Required | Validation and default                                       |
| ---------------------- | -------- | ------------------------------------------------------------ |
| `recipientAddress`     | Yes      | Non-zero EVM address.                                        |
| `amount`               | Yes      | Positive decimal integer string.                             |
| `durationSeconds`      | Yes      | Integer from `86400` through `4294967295`.                   |
| `cliffDurationSeconds` | No       | Integer from `0` through `durationSeconds`; defaults to `0`. |

When `tokensForSale` leaves a remainder and `allocations` is omitted, the API creates one allocation to `userAddress` with a 90-day duration and no cliff. Allocations are invalid when the entire supply is for sale.

#### Pool-fee beneficiaries

Each `poolFeeBeneficiaries` entry is `{ "address": <non-zero EVM address>, "sharesWad": <positive integer string> }`. Addresses are unique case-insensitively.

- Omitted or empty uses 95% for `userAddress` and 5% for the Airlock owner. If those addresses are the same, that address receives 100%.
- If the request omits the Airlock owner, request shares must total `950000000000000000`; the API appends the owner's 5% entry.
- If the request includes the Airlock owner, all shares must total `1e18` and that owner must receive at least 5%.
- The 10-entry maximum includes an owner entry appended by the API.

Successful responses report `effectiveConfig.poolFeeBeneficiariesSource` as `default`, `request`, or `none`. Dynamic `uniswapV2` uses `none`.

#### Governance

| Request value        | External mode                          |
| -------------------- | -------------------------------------- |
| omitted or `false`   | `noOp`                                 |
| `true`               | `default`                              |
| non-zero EVM address | `custom` governance with that multisig |

The selected mode must appear in the chain's `governanceModes`, and non-`noOp` governance also requires governance to be enabled for that chain.

### Static auction

Static requests use:

```json
{
  "auction": {
    "type": "static",
    "curveConfig": {
      "type": "preset",
      "preset": "medium"
    }
  }
}
```

`curveConfig` has one of two strict shapes.

**Preset**

| Field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"preset"`. |
| `preset` | Yes | `"low"`, `"medium"`, or `"high"`. The ranges are respectively $7,500–30,000, $50,000–150,000, and $250,000–750,000. |
| `fee` | No | `100`, `500`, `3000`, or `10000`; defaults to `10000`. |
| `numPositions` | No | Integer from `1` through `65535`; defaults to `15`. |
| `maxShareToBeSoldWad` | No | Positive integer string no greater than `1e18`; defaults to `350000000000000000`. |

**Range**

| Field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"range"`. |
| `marketCapStartUsd` | Yes | Positive number. |
| `marketCapEndUsd` | Yes | Positive number greater than `marketCapStartUsd`. |
| `fee` | No | `100`, `500`, `3000`, or `10000`; defaults to `10000`. |
| `numPositions` | No | Integer from `1` through `65535`; defaults to `15`. |
| `maxShareToBeSoldWad` | No | Positive integer string no greater than `1e18`; defaults to `350000000000000000`. |

Static requests do not accept `migration` or a multicurve initializer.

### Multicurve auction

Multicurve requests use `auction.type: "multicurve"`, a preset or ranges curve, and a mandatory flattened Rehype initializer. They do not accept `migration`.

#### Preset curve

| Field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"preset"`. |
| `presets` | No | Array containing `"low"`, `"medium"`, and/or `"high"`. Omitted or empty selects all three. |
| `fee` | No | Integer from `0` through `100000`; defaults to `500`. |
| `tickSpacing` | No | Integer from `1` through `32767`. When omitted, the API selects the largest spacing no greater than the fee-tier default that divides every boundary in the selected presets. |

#### Ranges curve

| Field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"ranges"`. |
| `fee` | No | Integer from `0` through `100000`; defaults to `3000`. |
| `tickSpacing` | No | Integer from `1` through `32767`. Omitted built-in fee tiers use the SDK spacing; omitted custom fees derive a spacing from the fee. |
| `curves` | Yes | Non-empty array of contiguous curve entries. |

Each curve entry requires positive `marketCapStartUsd`, `sharesWad`, and integer `numPositions` from `1` through `65535`. `marketCapEndUsd` is either a positive number greater than the start or `"max"`. Numeric neighboring ranges must be exactly contiguous, `"max"` is valid only on the final range, and all positive `sharesWad` values must total `1e18`.

#### Mandatory flattened Rehype initializer

`auction.initializer` has this wire shape:

```json
{
  "startFee": 100,
  "endFee": 10,
  "durationSeconds": 86400,
  "startingTime": 0,
  "feeDistributionInfo": {
    "assetFeesToAssetBuybackWad": "0",
    "assetFeesToNumeraireBuybackWad": "0",
    "assetFeesToBeneficiaryWad": "1000000000000000000",
    "assetFeesToLpWad": "0",
    "numeraireFeesToAssetBuybackWad": "0",
    "numeraireFeesToNumeraireBuybackWad": "0",
    "numeraireFeesToBeneficiaryWad": "1000000000000000000",
    "numeraireFeesToLpWad": "0"
  },
  "buybackDestination": "0x1111111111111111111111111111111111111111"
}
```

| Field | Required | Validation and default |
| --- | --- | --- |
| `startFee` | Yes | Integer from `0` through `800000`. |
| `endFee` | No | Integer from `0` through `800000`; defaults to `startFee` and cannot exceed it. |
| `durationSeconds` | No | Unsigned 32-bit integer; defaults to `0`. It must be greater than `0` when `startFee > endFee`. |
| `startingTime` | No | Unsigned 32-bit integer; defaults to `0`. |
| `feeDistributionInfo` | Yes | Eight non-negative WAD integer strings. The four `assetFeesTo*` values must total `1e18`, and the four `numeraireFeesTo*` values must independently total `1e18`. |
| `buybackDestination` | Exactly one routing form | Non-zero EVM address. |
| `rehypeFeeBeneficiaries` | Exactly one routing form | From 1 through 10 case-insensitively unique non-zero addresses with positive `sharesWad` values totaling `1e18`. |

`buybackDestination` and `rehypeFeeBeneficiaries` are mutually exclusive. Rehype beneficiary routing is independent of top-level `poolFeeBeneficiaries`. Do not add the Airlock owner to account for the protocol fee; Rehype reserves that fee before routing the remainder.

### Dynamic auction

Dynamic requests use:

```json
{
  "auction": {
    "type": "dynamic",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 500000,
      "marketCapMinUsd": 50000,
      "minProceeds": "1",
      "maxProceeds": "2"
    }
  },
  "migration": {}
}
```

| Curve field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"range"`. |
| `marketCapStartUsd` | Yes | Positive number. |
| `marketCapMinUsd` | Yes | Positive number lower than `marketCapStartUsd`. |
| `minProceeds` | Yes | Canonical non-negative decimal string without leading zeros and with at most 18 decimal places. Its value in 18-decimal units cannot exceed `uint256`; the largest value is `115792089237316195423570985008687907853269984665640564039457.584007913129639935`. |
| `maxProceeds` | Yes | Same encoding and maximum as `minProceeds`; must be positive and not lower than `minProceeds`. |
| `durationSeconds` | No | Positive integer; defaults to `604800`. |
| `epochLengthSeconds` | No | Positive integer; defaults to `43200` and must divide the effective duration evenly. |
| `fee` | No | Integer from `0` through `100000`; defaults to `10000`. |
| `tickSpacing` | Conditional | Integer from `1` through `30`; defaults to `30`. It is required when `fee` is not `100`, `500`, `3000`, or `10000`. |
| `gamma` | No | Integer from `1` through `8388607`; defaults to the SDK-computed value and must be divisible by effective tick spacing. |
| `numPdSlugs` | No | Integer from `1` through `15`; defaults to `5`. |

#### `uniswapV2` migration

```json
{
  "type": "uniswapV2",
  "feeBeneficiary": {
    "address": "0x1111111111111111111111111111111111111111",
    "percentage": 25
  }
}
```

`feeBeneficiary` is optional. Its address is non-zero and `percentage` is an integer from 1 through 50. Top-level `poolFeeBeneficiaries` is invalid with this migration. The migration sends 95% of LP tokens to the migration recipient and 5% to a one-year locker; locker exit fees belong to the Airlock owner.

#### `uniswapV4` migration

| Field                 | Required | Validation and default                                      |
| --------------------- | -------- | ----------------------------------------------------------- |
| `type`                | Yes      | `"uniswapV4"`.                                              |
| `fee`                 | Yes      | Integer from `0` through `150000`; fixed Uniswap V4 LP fee. |
| `tickSpacing`         | Yes      | Integer from `1` through `32767`.                           |
| `lockDurationSeconds` | Yes      | Unsigned 32-bit integer.                                    |
| `rehype`              | No       | Rehype migrator configuration below.                        |

A plain V4 migration uses `DopplerHookMigrator`. Adding `migration.rehype` uses `RehypeDopplerHookMigrator` and requires:

| Rehype migration field | Required | Validation and default |
| --- | --- | --- |
| `buybackDestination` | Yes | Non-zero EVM address. |
| `customFee` | Yes | Integer from `0` through `1000000`; this static hook fee is separate from the V4 LP `fee`. |
| `feeRoutingMode` | No | `"directBuyback"` or `"routeToBeneficiaryFees"`; defaults to `"directBuyback"`. |
| `feeDistributionInfo` | Yes | The same eight-field matrix and two independent `1e18` sum rules used by the multicurve initializer. |

`routeToBeneficiaryFees` accrues hook fees for collection by `buybackDestination`; it does not route through top-level `poolFeeBeneficiaries`.

### EVM create response

A successful submission returns `200`:

| Field | Type and meaning |
| --- | --- |
| `launchId` | `<chainId>:<txHash>` identifier used by the EVM status route. |
| `chainId` | Effective EVM chain ID. |
| `txHash` | Submitted 32-byte transaction hash. |
| `statusUrl` | Relative EVM status URL. |
| `predicted.tokenAddress` | Predicted token address. |
| `predicted.poolId` | Predicted 32-byte pool ID. |
| `predicted.gasEstimate` | Optional decimal integer string. |
| `effectiveConfig.tokensForSale` | Effective sale amount. |
| `effectiveConfig.allocationAmount` | Total vested allocation amount. |
| `effectiveConfig.vestingAllocations` | Effective allocation schedules. |
| `effectiveConfig.numeraireAddress` | Effective numeraire. |
| `effectiveConfig.numerairePriceUsd` | Effective USD price. |
| `effectiveConfig.poolFeeBeneficiariesSource` | `default`, `request`, or `none`. |
| `effectiveConfig.initializer` | Present for multicurve responses; the same flattened Rehype shape accepted in the request. |

A `200` response means the transaction was submitted, not that it is confirmed.

## Solana create routes

Solana create requests use one of two route-specific network forms:

- `POST /v1/launches` requires `network: "solanaDevnet"` or `"solanaMainnetBeta"`.
- `POST /v1/solana/launches` accepts optional `network: "devnet"` or `"mainnet-beta"`; omission uses the deployment's configured Solana default.

The Mainnet Beta values are recognized but return `501 SOLANA_NETWORK_UNSUPPORTED`. Executable creation uses Devnet.

Creation retries Solana RPC HTTP `429` responses with bounded exponential backoff. A configured `SOLANA_DEVNET_ALT_ADDRESS` is reused when the signed transaction fits; oversized launches fall back to a launch-specific lookup table and return `422 SOLANA_TRANSACTION_TOO_LARGE` if the rebuilt transaction still exceeds the packet limit.

### Solana request fields

| Field | Required | Validation and default |
| --- | --- | --- |
| `network` | Route-dependent | Required on the shared route and optional on the dedicated route, using the values above. |
| `tokenMetadata` | Yes | `name` is 1–32 characters, `symbol` is 1–10 characters, and `tokenURI` is 1–200 characters. |
| `economics.totalSupply` | Yes | Positive unsigned 64-bit decimal integer string. |
| `economics.baseForDistribution` | No | Non-negative unsigned 64-bit integer string; defaults to `"0"`. |
| `economics.baseForLiquidity` | No | Non-negative unsigned 64-bit integer string; defaults to `"0"`. Together with distribution it must remain below total supply. |
| `pairing.numeraireAddress` | No | Valid Solana address. Defaults to WSOL; WSOL is the only supported numeraire. |
| `pricing.numerairePriceUsd` | No | Positive number. Otherwise the configured fixed price or CoinGecko mode resolves WSOL/USD; without a source the request returns `422 SOLANA_NUMERAIRE_PRICE_REQUIRED`. |
| `feeBeneficiaries` | No | Up to 8 unique Solana addresses. A non-empty list uses positive `shareBps` values totaling `10000` and cannot include the initializer protocol beneficiary. |
| `governance` | No | Only `false` is accepted; omission has the same effect. |
| `migration` | No | `type` is `"none"`; optional CPMM controls are described below. |
| `auction` | Yes | XYK auction object described below. |

When custom fee beneficiaries are omitted, the service uses its configured default payer allocation unless the onchain protocol fee consumes the full share. A deployment whose payer is also the protocol beneficiary requires an explicit valid list.

#### Solana migration

`migration.type` is `"none"`. `supportCpmm` defaults to `false`. When it is `true`, `minimumQuoteRaise` is a required positive unsigned 64-bit integer string. Non-zero `baseForDistribution` or `baseForLiquidity` is valid only when CPMM migration is enabled. All API-created launches use Doppler launch hook v1; CPMM migration registration and hook features are independent.

#### Solana XYK auction

| Field | Required | Validation and default |
| --- | --- | --- |
| `type` | Yes | `"xyk"`. |
| `curveConfig.type` | Yes | `"range"`. |
| `curveConfig.marketCapStartUsd` | Yes | Positive finite number. |
| `curveConfig.marketCapEndUsd` | Yes | Positive finite number greater than the start. The derived virtual reserves must fit unsigned 64-bit values and reproduce the requested range within the service tolerance. |
| `curveFeeBps` | No | Integer from `0` through `10000`; an alias of `swapFeeBps`. |
| `swapFeeBps` | No | Integer from `0` through `10000`. If both fee fields are present they must match. If both are omitted, the onchain initializer minimum applies; the effective fee must remain within its onchain bounds. |
| `allowBuy` | No | Boolean; defaults to `true`. |
| `allowSell` | No | Boolean; defaults to `true`. |
| `cosignerGate` | No | Doppler-managed cosigner gate through Doppler launch hook v1. |
| `dynamicFee` | No | Dynamic fee schedule through Doppler launch hook v1. |

`cosignerGate` requires `type: "cosigner"` and does not accept a caller-provided signer. The API resolves the canonical managed cosigner from the hook's onchain configuration. Optional `expiry.mode` is `"disabled"` or `"unixTimestamp"`; omitted or disabled expiry is indefinite, while timestamp mode requires a non-negative unsigned 64-bit integer string in `expiry.value`. The gate works with or without CPMM migration.

`dynamicFee` requires `startFeeBps`, `endFeeBps`, and `durationSeconds`. Both fees are integers from `0` through `10000`; the end cannot exceed the start. Duration is a non-negative unsigned 32-bit integer string and must be non-zero for a decay. Optional `startingTime` is a non-negative signed 64-bit integer string and defaults to `"0"`. The effective swap fee is the greater of the schedule fee and `swapFeeBps`; dynamic fees may be combined with managed cosigning.

Deterministic request validation runs before dependency readiness checks. Readiness failures return `503 SOLANA_NOT_READY`, simulation failures return `422 SOLANA_SIMULATION_FAILED`, and submission failures return `502 SOLANA_SUBMISSION_FAILED`.

### Solana create response

A successful submission returns `200` with:

- `launchId`, the base58 launch PDA;
- `network`, `signature`, `explorerUrl`, and `statusUrl`;
- `predicted.tokenAddress`, `launchAuthorityAddress`, `launchFeeStateAddress`, `baseVaultAddress`, and `quoteVaultAddress`;
- `effectiveConfig.tokensForSale`, `allocationAmount`, `baseForDistribution`, `baseForLiquidity`, `allocationLockMode: "none"`, `numeraireAddress`, `numerairePriceUsd`, `curveVirtualBase`, `curveVirtualQuote`, `curveFeeBps`, `swapFeeBps`, `feeBeneficiariesSource`, `feeBeneficiaries`, `allowBuy`, `allowSell`, and `tokenDecimals`.

## Status endpoints

### `GET /v1/launches/:launchId`

`launchId` must match `<chainId>:0x<64 hex characters>`. Invalid syntax returns `422 INVALID_LAUNCH_ID`. The `200` response contains `launchId`, `chainId`, `txHash`, `status`, and `confirmations`.

| Status | Additional fields |
| --- | --- |
| `pending` | No result; the transaction exists without a receipt. |
| `not_found` | No result; neither transaction nor receipt is currently available. |
| `reverted` | `error: { code: "TX_REVERTED", message }`. |
| `confirmed` | `result.tokenAddress`, `poolOrHookAddress`, `poolId`, and decimal-string `blockNumber`. |

Provider or confirmed-transaction decoding failures return `502`.

### `GET /v1/solana/launches/:launchAddress`

The path value must be a valid Solana address. Invalid syntax returns `422 SOLANA_INVALID_ADDRESS`, a missing account returns `404 SOLANA_LAUNCH_NOT_FOUND`, and an RPC lookup failure returns `502 SOLANA_LOOKUP_FAILED`.

The `200` response contains `network`, `launchAddress`, `phase: { code, label }`, `authority`, `namespace`, `baseMint`, `quoteMint`, `baseVault`, `quoteVault`, `baseTotalSupply`, `baseForDistribution`, `baseForLiquidity`, `baseForCurve`, `curveVirtualBase`, `curveVirtualQuote`, `curveFeeBps`, `swapFeeBps`, `allowBuy`, `allowSell`, `hookProgram`, `hookFlags`, `migratorProgram`, `quoteDeposited`, and `tokenDecimals`.

## `GET /v1/capabilities`

This authenticated endpoint returns only configured EVM chains and never returns RPC URLs:

- `defaultChainId` is the configured request default or `null`;
- `pricing` contains `enabled` and `provider`;
- each `chains` entry contains `chainId`, enabled `auctionTypes`, `multicurveInitializers`, `migrationModes`, `governanceModes`, and `governanceEnabled`;
- a chain with multicurve support reports only `"rehype"` in `multicurveInitializers`;
- governance modes are drawn from `"noOp"`, `"default"`, and `"custom"`;
- migration modes are drawn from `"uniswapV2"` and `"uniswapV4"`;
- `solana` contains `enabled`, `supportedNetworks`, `unsupportedNetworks`, `dedicatedRouteInputAliases`, `creationOnly`, `numeraireAddress`, and `priceResolutionModes` (`request`, `fixed`, and/or `coingecko`).

Call this endpoint before assembling a request instead of assuming that every configured chain enables every mode.

## Operational endpoints

### `GET /health`

This is the only unauthenticated endpoint. A healthy process returns `200`:

```json
{ "status": "ok" }
```

It does not check RPC or Solana dependencies.

### `GET /ready`

This authenticated endpoint checks each configured EVM RPC and the enabled Solana dependencies. It returns `200` when all checks pass or `503` when any check fails.

The response contains:

- `status: "ready" | "degraded"`;
- `checks[]` with EVM `chainId`, `ok`, and either decimal-string `latestBlock` or an `error`;
- `solana.enabled`, `solana.ok`, optional `solana.network`, and `solana.checks[]` entries named `rpcReachable`, `latestBlockhash`, `initializerConfig`, or `addressLookupTable`.

### `GET /metrics`

This authenticated endpoint returns `200` with:

- `startedAt`, an ISO date-time;
- non-negative integer `uptimeSec`;
- `http.totalRequests`;
- `http.byStatusClass`, a map of status-class counters; and
- non-negative `http.avgDurationMs`.
