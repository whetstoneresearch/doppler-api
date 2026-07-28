# Doppler API

A self-hosted TypeScript REST API for creating and monitoring Doppler token
launches without embedding the Doppler SDK. It supports EVM launches across
configured chains, an optional Solana launch surface, durable idempotency, and
health and metrics endpoints for production operation.

## Quick start

Requirements: Node.js 22 and npm 10.

```bash
npm install
cp .env.example .env
```

Set `API_KEY`, `PRIVATE_KEY`, and at least one EVM RPC URL in `.env`, then start
the development server:

```bash
npm run dev
```

For a production build:

```bash
npm run build
npm start
```

The repository includes a `Dockerfile` and `docker-compose.yml`. CI and
container builds use npm with the committed `package-lock.json`.

## API surface

- `POST /v1/launches`
- `POST /v1/launches/static`
- `POST /v1/launches/multicurve`
- `POST /v1/launches/dynamic`
- `GET /v1/launches/:launchId`
- `GET /v1/capabilities`
- `POST /v1/solana/launches`
- `GET /v1/solana/launches/:launchAddress`
- `GET /health`
- `GET /ready`
- `GET /metrics`

Every route except `GET /health` requires `x-api-key`. Create routes accept an
`Idempotency-Key`; shared deployments require one.

Use [`docs/openapi.yaml`](docs/openapi.yaml) for exact request and response
schemas and copyable examples. The human-readable endpoint guide is
[`docs/api-reference.md`](docs/api-reference.md).

## Configuration

The minimum EVM configuration is:

- `API_KEY`: authenticates API callers
- `PRIVATE_KEY`: signs EVM transactions
- one or more named EVM RPC URLs

Each non-empty RPC variable enables its corresponding chain:

| Chain        | Chain ID | Environment variable   |
| ------------ | -------: | ---------------------- |
| Ethereum     |        1 | `ETHEREUM_RPC_URL`     |
| Monad        |      143 | `MONAD_RPC_URL`        |
| Robinhood    |     4663 | `ROBINHOOD_RPC_URL`    |
| Base         |     8453 | `BASE_RPC_URL`         |
| Base Sepolia |    84532 | `BASE_SEPOLIA_RPC_URL` |

`DEFAULT_CHAIN_ID` may identify one enabled chain. Without it, each EVM launch
request must supply `chainId`. The service does not fall back to Base Sepolia or
the first configured chain. `GET /v1/capabilities` reports enabled chains
without exposing RPC URLs.

Standalone mode uses local durable state by default. Set
`DEPLOYMENT_MODE=shared` for multiple replicas; shared mode requires Redis, the
Redis idempotency backend, and idempotency keys on create requests. Solana,
pricing, CORS, rate limiting, logging, and readiness checks have separate
optional settings.

See [`docs/configuration.md`](docs/configuration.md) and [`.env.example`](.env.example)
for the complete configuration reference.

## Supported EVM launches

`POST /v1/launches` accepts three family-discriminated request shapes. The
family-specific routes accept the same corresponding shapes.

- `static`: a `low`, `medium`, or `high` preset or a manual Uniswap V3 range
- `multicurve`: presets or contiguous manual ranges, with a `standard` or
  `rehype` initializer
- `dynamic`: a dynamic auction with exactly one `uniswapV2` or `uniswapV4`
  migration configuration

All EVM families use `DopplerERC20V1` and support optional balance controls.
They also support governance configuration and up to 10 non-market allocation
vesting schedules. EVM pool-fee routing uses `poolFeeBeneficiaries`; dynamic
`uniswapV2` instead supports its singular proceeds `feeBeneficiary`.
Rehype's `initializer.config.rehypeFeeBeneficiaries` is a separate hook-fee
routing list.
Both multicurve initializer modes are submitted through the canonical
`DopplerHookInitializer`; `rehype` changes the hook configuration, not the
initializer contract.
Dynamic `uniswapV4` migrations use a fixed LP fee. Optional
`migration.rehype` selects `RehypeDopplerHookMigrator` with a separate static
hook fee and eight-field distribution matrix.

EVM integer-string and WAD fields accept decimal digits only. Malformed values
are rejected as `422 INVALID_REQUEST`.

For exact defaults, validation rules, fee distribution, curve constraints, and
allocation behavior, see:

- [`docs/api-reference.md`](docs/api-reference.md)
- [`docs/custom-curves.md`](docs/custom-curves.md)
- [`docs/launch-examples.md`](docs/launch-examples.md)
- [`docs/openapi.yaml`](docs/openapi.yaml)

## Solana

Solana uses dedicated configuration and routes. Its request contract uses
Solana `feeBeneficiaries` with `shareBps`, independently of the EVM
`poolFeeBeneficiaries` contract. Solana support is disabled unless
`SOLANA_ENABLED=true`.

## Operations

Errors use this envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Validation and incompatible EVM family fields return `422 INVALID_REQUEST`.
An exact retry of a completed request is replayed from its idempotency record
before current request validation, so requests completed under an older API
contract remain retryable with their original key and payload.
Ambiguous EVM transaction submission may return
`409 IDEMPOTENCY_KEY_IN_DOUBT`; reconcile the recorded signer and nonce before
retrying. The same error is returned with the completed launch or transaction
identifiers when the API cannot durably save a completed response. A lost
distributed nonce lock returns `503 NONCE_LOCK_LOST`; retry the identical
request with the same idempotency key.
Create simulations and token-collision checks use pending chain state so a
token deployed by an unmined transaction is not submitted again.

Operational references:

- [`docs/errors.md`](docs/errors.md): error codes and retry guidance
- [`docs/runbook.md`](docs/runbook.md): health checks and incident procedures
- [`SECURITY.md`](SECURITY.md): vulnerability reporting

## Development

```bash
npm run lint
npm run typecheck
npm test
```

`npm run test:all` runs unit, integration, and the onchain live suite. It
enables live execution and requires the RPC and signer environment described
in `.env.example`.

See [`docs/contributing.md`](docs/contributing.md) for the contributor workflow
and [`docs/README.md`](docs/README.md) for the documentation index.
