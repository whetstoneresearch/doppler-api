# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- Malformed EVM WAD strings now return `422 INVALID_REQUEST` instead of an internal server error.
- Multicurve launches now use the canonical `DopplerHookInitializer`, and
  omitted preset tick spacing is aligned to every selected curve boundary.
- EVM create simulation and token-collision detection now use pending chain
  state, preventing broadcasts that target an address deployed by an unmined
  transaction.

### Changed

- `npm run test:all` now enables and executes the onchain live suite.

## [0.2.0] - 2026-07-27

### Added

- EVM launches support DopplerERC20V1 balance controls, per-recipient vesting schedules, default and launchpad governance, and Rehype multicurve initialization.
- Dynamic EVM launches support Uniswap V2 split, fixed-fee Doppler Hook V4
  migrations, and Rehype Doppler Hook migrations with static hook-fee routing.

### Changed

- Updated `@whetstone-research/doppler-sdk` from `1.0.29` to `1.0.33` and aligned EVM launch assembly with the canonical SDK contracts.
- EVM create requests use strict auction-family contracts. Static and multicurve launches no longer accept a public migration field, and EVM pool fee routing uses `poolFeeBeneficiaries`.
- EVM chain availability is derived from named RPC configuration for Ethereum, Monad, Robinhood, Base, and Base Sepolia. `DEFAULT_CHAIN_ID` is optional, and requests no longer fall back to another configured chain.
- EVM transaction retry handling distinguishes pre-broadcast failures from ambiguous submissions and preserves reconciliation details for transactions that may have been accepted.

## [0.1.0] - 2026-02-23

### Added

- TypeScript REST API with `POST /v1/launches` and `POST /v1/launches/multicurve`.
- Launch status endpoint: `GET /v1/launches/:launchId`.
- Operational endpoints: `GET /health`, `GET /ready`, `GET /metrics`.
- Capability matrix endpoint: `GET /v1/capabilities`.
- Multichain-aware launch identifiers (`<chainId>:<txHash>`).
- Idempotent create behavior via `Idempotency-Key`.
- Pricing resolution with request override + provider fallback.
- Preset and custom ranges multicurve support.
- Unit, integration, and live test suites with structured output.
- GitHub CI workflow running `npm run check`.
- Docker Compose runtime (`docker-compose.yml`).

### Security and Maintenance

- Added `LICENSE` (MIT).
- Added `SECURITY.md` reporting policy.
- Added Node version metadata (`.nvmrc`, `package.json` `engines`).

### Limitations

- Governance beyond no-op is not implemented (`governance: true` returns `501 GOVERNANCE_NOT_IMPLEMENTED`).
- Migrations beyond `noOp` are not implemented.
- Auction types beyond multicurve (`static`, `dynamic`) are not implemented.
