# Changelog

All notable changes to this project will be documented in this file.

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

### Current MVP Limitations

- Governance beyond no-op is not implemented (`governance: true` returns `501 GOVERNANCE_NOT_IMPLEMENTED`).
- Migrations beyond `noOp` are not implemented.
- Auction types beyond multicurve (`static`, `dynamic`) are not implemented.
