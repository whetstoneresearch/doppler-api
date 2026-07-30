# Doppler API

A self-hosted TypeScript REST API for creating and monitoring Doppler token launches without embedding the Doppler SDK. It supports EVM launches across configured chains, an optional Solana launch surface, durable idempotency, and health and metrics endpoints for production operation.

## Run locally

Requirements: Node.js 22 and npm 10.

```bash
npm install
cp .env.example .env
```

Set `API_KEY`, `PRIVATE_KEY`, and at least one named EVM RPC URL in `.env`. The following example uses `BASE_SEPOLIA_RPC_URL` and chain ID `84532`. Start the development server:

```bash
npm run dev
```

The API listens on `http://localhost:3000` by default.

## Create a multicurve launch

This quick-start sends a minimal multicurve request to the shared EVM launch route. Multicurve launches require the flattened Rehype initializer shown below. Set the request's addresses for your launch, and use an enabled `chainId`.

```bash
curl --request POST 'http://localhost:3000/v1/launches' \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --header 'Idempotency-Key: rehype-quick-start-1' \
  --data '{
    "chainId": 84532,
    "userAddress": "0x1111111111111111111111111111111111111111",
    "tokenMetadata": {
      "name": "Example Token",
      "symbol": "EXAMPLE",
      "tokenURI": "ipfs://example-token"
    },
    "economics": {
      "totalSupply": "1000000000000000000000000"
    },
    "pricing": {
      "numerairePriceUsd": 2500
    },
    "auction": {
      "type": "multicurve",
      "curveConfig": {
        "type": "preset",
        "presets": ["medium"]
      },
      "initializer": {
        "startFee": 3000,
        "feeDistributionInfo": {
          "assetFeesToAssetBuybackWad": "250000000000000000",
          "assetFeesToNumeraireBuybackWad": "250000000000000000",
          "assetFeesToBeneficiaryWad": "250000000000000000",
          "assetFeesToLpWad": "250000000000000000",
          "numeraireFeesToAssetBuybackWad": "250000000000000000",
          "numeraireFeesToNumeraireBuybackWad": "250000000000000000",
          "numeraireFeesToBeneficiaryWad": "250000000000000000",
          "numeraireFeesToLpWad": "250000000000000000"
        },
        "buybackDestination": "0x2222222222222222222222222222222222222222"
      }
    }
  }'
```

See the [Rehype Guide](docs/rehype.md) for fee schedules, distribution weights, initializer routing, and dynamic migration configuration. The [Launch Request Examples](docs/launch-examples.md) cover every supported EVM family. EVM supply, sale, vesting-allocation, and balance-limit amounts are canonical positive `uint256` decimal strings without leading zeros. Dynamic proceeds are canonical decimal strings with at most 18 decimal places whose scaled value fits `uint256`. Multicurve `tickSpacing` is at most 32,767, and each manual range supports at most 65,535 positions.

## API surface

The shared EVM launch route dispatches by `auction.type`:

- `POST /v1/launches`

The family-specific routes accept the corresponding EVM request shape:

- `POST /v1/launches/static`
- `POST /v1/launches/multicurve`
- `POST /v1/launches/dynamic`

Status and operational routes are:

- `GET /v1/launches/:launchId`
- `GET /v1/capabilities`
- `POST /v1/solana/launches`
- `GET /v1/solana/launches/:launchAddress`
- `GET /health`
- `GET /ready`
- `GET /metrics`

Every route except `GET /health` requires `x-api-key`. Create routes accept an `Idempotency-Key`; shared deployments require one.

Use the [OpenAPI specification](docs/openapi.yaml) for exact request and response schemas and the [API reference](docs/api-reference.md) for endpoint behavior.

## Solana behavior

Use `POST /v1/solana/launches` for dedicated Solana creation, or the shared route with a canonical `solanaDevnet` or `solanaMainnetBeta` network. Only Devnet is executable.

All API-created Solana launches use Doppler launch hook v1. `auction.cosignerGate` uses the canonical managed cosigner from the hook's onchain configuration; callers do not provide a cosigner address, and optional expiry supports only `disabled` or `unixTimestamp`. `auction.dynamicFee` may be used independently or with managed cosigning.

When `SOLANA_DEVNET_ALT_ADDRESS` is configured, creation reuses it when the transaction fits and falls back to a launch-specific lookup table otherwise. Solana RPC requests retry HTTP `429` responses with bounded exponential backoff; a transaction that remains oversized returns `422 SOLANA_TRANSACTION_TOO_LARGE`.

Enable Solana with a funded payer from `SOLANA_KEYPAIR_PATH` (preferred) or inline `SOLANA_KEYPAIR`, but not both. See the [Configuration Reference](docs/configuration.md) for the complete runtime and live-test requirements.

## Supported EVM families

| Family | Curve | Migration |
| --- | --- | --- |
| `static` | `low`, `medium`, or `high` preset; or a manual Uniswap V3 range | None |
| `multicurve` | Presets or contiguous manual ranges | None; a Rehype initializer is required |
| `dynamic` | Dynamic range | Required Uniswap V2 or Uniswap V4 migration; Uniswap V4 can add Rehype |

All EVM families use `DopplerERC20V1`. See the [Custom Curve Guide](docs/custom-curves.md) for curve configuration and the [Rehype Guide](docs/rehype.md) for initializer and migrator configuration.

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

`DEFAULT_CHAIN_ID` may identify one enabled chain. Without it, each EVM launch request supplies `chainId`. The service does not fall back to Base Sepolia or the first configured chain. `GET /v1/capabilities` reports enabled chains without exposing RPC URLs.

Standalone mode uses local durable state by default. Set `DEPLOYMENT_MODE=shared` for multiple replicas; shared mode requires Redis, the Redis idempotency backend, and idempotency keys on create requests.

See the [Configuration Reference](docs/configuration.md) and [`.env.example`](.env.example) for EVM, Solana, pricing, CORS, rate limiting, logging, and readiness settings.

## Production and operations

Create a production build and start it:

```bash
npm run build
npm start
```

The repository includes a `Dockerfile` and `docker-compose.yml`. CI and container builds use npm with the committed `package-lock.json`.

An exact retry of a completed request replays its durable idempotency record. Ambiguous transaction submission returns `409 IDEMPOTENCY_KEY_IN_DOUBT`; lost distributed nonce ownership returns `503 NONCE_LOCK_LOST`. See [Error Handling](docs/errors.md) for response codes and the [Operations Runbook](docs/runbook.md) for health checks, recovery, and incident procedures.

## Development

```bash
npm run lint
npm run typecheck
npm test
```

`npm run test:all` runs unit, integration, and onchain live coverage. It requires the RPC and signer environment described in `.env.example`.

See the [Contributing Guide](docs/contributing.md) for the contributor workflow and the [Documentation Index](docs/README.md) for all guides and references.
