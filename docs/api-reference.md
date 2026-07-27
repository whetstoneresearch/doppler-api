# API Reference

See the [OpenAPI specification](openapi.yaml) for complete request and response
schemas and examples.

## Authentication and errors

Send `x-api-key` on every route except `GET /health`. Create routes accept
`Idempotency-Key`; shared deployments require it.

Errors use `{ "error": { "code", "message", "details?" } }`. Invalid or
incompatible request data returns `422 INVALID_REQUEST`.

EVM launch requests may omit `chainId` when the deployment defines
`DEFAULT_CHAIN_ID`. Otherwise, omission returns `422 CHAIN_ID_REQUIRED`.
Requesting a supported chain without an enabled named RPC returns
`422 CHAIN_NOT_CONFIGURED`; the request does not fall back to another chain.

## `POST /v1/launches`

Creates an EVM or Solana launch request. EVM requests use one of these auction
families:

- `solanaMainnetBeta` -> `501 SOLANA_NETWORK_UNSUPPORTED`
- non-WSOL numeraire -> `422 SOLANA_NUMERAIRE_UNSUPPORTED`
- missing price after request/env/provider resolution -> `422 SOLANA_NUMERAIRE_PRICE_REQUIRED`
- invalid metadata -> `422 SOLANA_INVALID_METADATA`
- invalid economics or unsupported reserves -> `422 SOLANA_INVALID_ECONOMICS`
- invalid market-cap range or fee input -> `422 SOLANA_INVALID_CURVE`
- invalid fee beneficiaries -> `422 SOLANA_INVALID_FEE_BENEFICIARIES`
- parameters that remain oversized after launch-specific ALT compression -> `422 SOLANA_TRANSACTION_TOO_LARGE`
- readiness failure -> `503 SOLANA_NOT_READY`
- simulation failure -> `422 SOLANA_SIMULATION_FAILED`
- submission failure -> `502 SOLANA_SUBMISSION_FAILED`
- ambiguous confirmation -> `409 IDEMPOTENCY_KEY_IN_DOUBT`

Deterministic request validation runs before dependency readiness checks.

---
- Static: `auction.type: "static"` with a static preset or range. `migration`
  is not accepted.
- Multicurve: `auction.type: "multicurve"` with presets or ranges and optional
  `initializer.type: "standard" | "rehype"`. `migration` is not accepted.
- Dynamic: `auction.type: "dynamic"` with exactly one migration:
  `uniswapV2` or `uniswapV4`.

Static fees are limited to `100`, `500`, `3000`, or `10000`. Multicurve pool
fees may be `0`.

Dynamic ranges require descending market caps, duration evenly divisible by
epoch length, and gamma aligned to tick spacing. A non-standard fee requires
explicit tick spacing of at most `30`.

### Token metadata and fee beneficiaries

EVM token metadata uses `DopplerERC20V1` and may include `maxBalanceLimit`,
`balanceLimitEnd`, `controller`, and `excludedFromBalanceLimit`.

EVM pool fees use `poolFeeBeneficiaries`; `feeBeneficiaries` is rejected for
EVM requests. `poolFeeBeneficiaries` is not valid with dynamic `uniswapV2`.
That migration instead accepts an optional
`feeBeneficiary: { address, percentage }`, where `percentage` is an integer
from 1 through 50.

Dynamic `uniswapV2` sends 95% of LP tokens to the migration recipient and 5%
to a one-year locker. Locker exit fees belong to the Airlock owner. Dynamic
`uniswapV4` creates a fixed-fee pool through `DopplerHookMigrator`. Adding
`migration.rehype` selects `RehypeDopplerHookMigrator`; its static
`customFee` and eight-field distribution matrix are separate from the
Uniswap V4 LP fee.

### Rehype routing

A Rehype initializer accepts its eight-field WAD fee-distribution matrix and
exactly one routing option:

- `buybackDestination`; or
- 1 to 10 unique `rehypeFeeBeneficiaries` with positive WAD shares totaling
  `1e18`.

`initializer.config.rehypeFeeBeneficiaries` controls hook-fee routing
independently of top-level `poolFeeBeneficiaries`. Do not include the Airlock
owner to account for the protocol fee; Rehype reserves that fee before applying
the beneficiary routing.

Migrator-side Rehype uses `migration.rehype.buybackDestination` rather than a
Rehype beneficiary list. Its optional `feeRoutingMode` is `directBuyback` or
`routeToBeneficiaryFees`. The latter accrues hook fees for collection by
`buybackDestination`; it does not use top-level `poolFeeBeneficiaries`.

### Governance

EVM governance accepts an omitted value, `false`, `true`, or an EVM address:

| Request value      | Governance mode          |
| ------------------ | ------------------------ |
| omitted or `false` | `noOp`                   |
| `true`             | `default`                |
| EVM address        | `launchpad { multisig }` |

Successful EVM responses include
`effectiveConfig.poolFeeBeneficiariesSource` with `default`, `request`, or
`none`. Dynamic `uniswapV2` returns `none`.

## Family routes

`POST /v1/launches/static`, `POST /v1/launches/multicurve`, and
`POST /v1/launches/dynamic` accept their corresponding EVM request schemas.

## `POST /v1/solana/launches`

Creates a Solana launch request. Solana `feeBeneficiaries` use Solana addresses
and `shareBps`.

The dedicated route uses `devnet`; the generic launch route uses
`solanaDevnet`. The corresponding Mainnet Beta values are recognized but
return `501 SOLANA_NETWORK_UNSUPPORTED`.

## `GET /v1/capabilities`

Returns the default chain, or `null` if none is configured; pricing state;
configured EVM chains; and Solana availability. RPC URLs are not included.

Each EVM chain reports its `auctionTypes`, multicurve initializers (`standard`
and `rehype`), migrations (`uniswapV2` and `uniswapV4`), and governance modes
(`noOp`, `default`, and `launchpad`).

## Status and operations

- `GET /v1/launches/:launchId` returns EVM launch status.
- `GET /v1/solana/launches/:launchAddress` returns Solana launch state.
- `GET /health`, `GET /ready`, and `GET /metrics` expose service health and
  operational metrics.
