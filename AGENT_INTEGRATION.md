# Integration Guide

The machine-readable contract and request examples are in
[`docs/openapi.yaml`](docs/openapi.yaml).

## Start and authenticate

```bash
npm install
cp .env.example .env
npm run dev
```

Set `API_KEY`, `PRIVATE_KEY`, and one or more named EVM RPC variables. Send
`x-api-key` on every endpoint except `GET /health`; send a stable
`Idempotency-Key` for create retries and always in shared deployments.

## Choose an EVM family

Use exactly one family shape:

- `static`: do not include `migration`.
- `multicurve`: do not include `migration`. Choose the `standard` or `rehype`
  initializer. For Rehype, each currency-side set of four WAD shares must sum
  to `1e18`. Choose exactly one route: `buybackDestination`, or 1 to 10 unique
  `rehypeFeeBeneficiaries` whose positive `sharesWad` values sum to `1e18`.
- `dynamic`: include exactly one `migration` with type `uniswapV2` or
  `uniswapV4`.

Optional EVM token controls are
`maxBalanceLimit` (positive integer string below total supply),
`balanceLimitEnd` (future Unix timestamp), `controller` (EVM address), and
`excludedFromBalanceLimit` (case-insensitively unique EVM addresses).
The two balance-limit fields must be supplied together.

## Dynamic migration input

`uniswapV2` accepts optional `feeBeneficiary: { address, percentage }`, where
`percentage` is an integer from 1 through 50. Do not send top-level
`poolFeeBeneficiaries` for V2. LP disposition has no API controls: 95% goes to
the migration recipient and 5% to a one-year locker whose exit fees go to the
Airlock owner.

For `uniswapV4`, provide non-negative `fee`, positive `tickSpacing`, and
non-negative `lockDurationSeconds`. The migrated pool uses that fixed LP fee
and accepts top-level `poolFeeBeneficiaries`.

Add `migration.rehype` to use `RehypeDopplerHookMigrator`. It requires a
non-zero `buybackDestination`, a static `customFee` from 0 through 1,000,000,
and the eight-field `feeDistributionInfo` matrix. Each currency-side row must
sum to `1e18`. `feeRoutingMode` is optional and defaults to `directBuyback`;
the other value is `routeToBeneficiaryFees`. The Rehype `customFee` is
separate from the migration's fixed Uniswap V4 LP `fee`.
`routeToBeneficiaryFees` accrues hook fees for collection by
`buybackDestination`; it does not use `poolFeeBeneficiaries`.

Use `poolFeeBeneficiaries` only for EVM pool fees; EVM requests reject
`feeBeneficiaries`. It has at most 10 unique addresses. The default split is
95% user and 5% protocol owner. If the protocol owner is omitted, supply 95%
and the API appends 5%; if included, the total is 100% and that owner receives
at least 5%.

Rehype `initializer.config.rehypeFeeBeneficiaries` is not a pool-beneficiary list.
The API neither inserts nor requires the Airlock owner. The owner's protocol
fee is reserved separately before the remaining hook fee is routed.

## Governance and allocations

- Omit governance or set it to `false` to disable it.
- Set it to `true` for default governance.
- Set it to an EVM address to use that address as the launchpad multisig.

`tokensForSale` defaults to `totalSupply`. The remaining supply can use up to
10 independent vesting schedules. Each entry has `recipientAddress`, `amount`,
`durationSeconds`, and optional `cliffDurationSeconds`; one recipient may have
multiple entries. Static accepts presets or a manual range. Multicurve
accepts presets or contiguous ranges and preserves final `marketCapEndUsd:
"max"`. Multicurve fees may be `0`.

Static custom fees are limited to `100`, `500`, `3000`, or `10000`. For a
dynamic range, `marketCapMinUsd` must be less than `marketCapStartUsd`;
`epochLengthSeconds` must divide the effective duration; `gamma` must be
divisible by the effective tick spacing; and a non-standard fee requires an
explicit `tickSpacing` no greater than `30`.

## RPC selection and capabilities

Enable any subset of `ETHEREUM_RPC_URL` (1), `MONAD_RPC_URL` (143),
`ROBINHOOD_RPC_URL` (4663), `BASE_RPC_URL` (8453), and
`BASE_SEPOLIA_RPC_URL` (84532). `DEFAULT_CHAIN_ID` is optional and, when set,
must identify one of those enabled chains. A request with `chainId` uses that
enabled chain. A request without it uses the configured default or fails with
`CHAIN_ID_REQUIRED` when no default is configured. An explicitly requested
supported chain without a configured named RPC fails with
`CHAIN_NOT_CONFIGURED`; the service never falls back to another chain.

Call `GET /v1/capabilities` before assembling a request. It lists only enabled
chains, reports the default as its chain ID or `null`, and exposes no RPC
values. EVM effective responses expose
`poolFeeBeneficiariesSource: "default" | "request" | "none"`; dynamic V2 migration
uses `"none"`.

## Solana request model

Solana payloads use `feeBeneficiaries` with `shareBps`.
Do not apply EVM `poolFeeBeneficiaries` or EVM token/governance controls to
Solana. Use `POST /v1/solana/launches` for dedicated Solana creation.

## Errors and retry

Malformed or unsupported EVM fields, unknown nested keys, and incompatible
family combinations return `422 INVALID_REQUEST`. Reuse an idempotency key
only for the identical request. A `409 IDEMPOTENCY_KEY_IN_DOUBT` requires
reconciling the original EVM signer and nonce, or the recorded Solana
signature, before using a new key. The API persists ambiguous EVM transport
failures and nonce responses that may indicate acceptance, and does not
automatically resubmit them. Deterministic wallet or provider rejections may
be retried with the same key after correction. `503 NONCE_LOCK_LOST` occurs
before broadcast and is safe to retry with the same key.
A confirmed pre-broadcast token address collision returns
`409 TOKEN_ADDRESS_COLLISION`; retry the launch to use a different salt.
