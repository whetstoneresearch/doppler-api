# Doppler API

TypeScript REST API for creating Doppler launches.

## Disclaimer

This project is in active development & not ready for production use.

## Endpoints

- `POST /v1/launches`
- `POST /v1/solana/launches`
- `POST /v1/launches/multicurve` (alias)
- `POST /v1/launches/static` (alias)
- `POST /v1/launches/dynamic` (alias)
- `GET /v1/launches/:launchId`
- `GET /v1/capabilities`
- `GET /metrics`
- `GET /health`
- `GET /ready`

Auth model:

- `x-api-key` is required on all endpoints except `GET /health`.

## Error behavior

- Error envelope shape: `{ "error": { "code", "message", "details?" } }`
- Rate limiting returns `429` with code `RATE_LIMITED`.
- `GET /health` rate limits are keyed by client IP; spoofed `x-api-key` values do not create new buckets.
- `5xx` responses always return a generic client message: `"Internal server error"`.
  Inspect server logs and correlate by `x-request-id` for full diagnostics.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

## Configuration model

- `doppler.config.ts` is the canonical source for non-secret runtime settings.
- Environment variables override typed settings at runtime.
- Required secrets remain in env: `API_KEY`, `PRIVATE_KEY` (and `REDIS_URL` when needed).
- The template object is type-checked via `DopplerTemplateConfigV1`; config shape drift fails build/typecheck.

## Current target feature set

- Auction types:
  - `multicurve` (recommended default on V4-capable networks)
  - `dynamic` (for higher-value assets that need maximally capital-efficient price discovery; supports `migration.type="uniswapV2"` or `migration.type="uniswapV4"` in this API profile)
  - `static` (Uniswap V3 static launch with lockable beneficiaries; compatibility fallback for networks without Uniswap V4 support)
- Multicurve initializer modes:
  - `standard` (implemented via scheduled initializer with `startTime=0`)
  - `scheduled` (`startTime` required)
  - `decay` (`startFee`, `durationSeconds`, optional `startTime`)
  - `rehype` (hook-based initializer config)
- Migration modes:
  - `noOp` for multicurve/static
  - `uniswapV2` and `uniswapV4` for dynamic
  - `uniswapV3` is not supported and returns `501 MIGRATION_NOT_IMPLEMENTED`
- Solana:
  - create via `POST /v1/solana/launches`
  - `POST /v1/launches` also accepts Solana when `network` is `solanaDevnet` or `solanaMainnetBeta`
  - Solana create endpoints do not expose a status route
  - only `solanaDevnet` is executable
  - only WSOL is supported as numeraire
  - strict request shape; unsupported EVM-only fields are rejected
- Governance: `enabled=false` is the active profile, eg. `noOp`
- Token allocation profile:
  - Default: 100% of `totalSupply` is allocated to the multicurve market.
  - Optional: set `economics.tokensForSale` to allocate less to the market.
  - Remainder (`totalSupply - tokensForSale`) is allocated to non-market allocation recipients.
  - Optional: set `economics.allocations.recipients` (max 10 unique recipients) to split the non-market remainder.
- Multicurve design reference: [Doppler Multicurve whitepaper](https://doppler.lol/multicurve.pdf).
- Guidance: prefer `multicurve` whenever the target chain has Uniswap V4 support. Use `static` only when V4 is unavailable.

## Scope and roadmap

- This API profile is at feature parity with the other Doppler launch APIs for the supported launch flows.

## Launch ID format

- EVM: `<chainId>:<txHash>`
- Solana: base58 launch PDA

Examples:

- `84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
- `8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP`

## Create launch example

### Request

```http
POST /v1/launches
x-api-key: <API_KEY>
Idempotency-Key: <UNIQUE_KEY>
content-type: application/json
```

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "integrationAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "My Token",
    "symbol": "MTK",
    "tokenURI": "ipfs://my-token-metadata"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000",
    "tokensForSale": "800000000000000000000000",
    "allocations": {
      "recipients": [
        {
          "address": "0x1111111111111111111111111111111111111111",
          "amount": "100000000000000000000000"
        },
        {
          "address": "0x2222222222222222222222222222222222222222",
          "amount": "100000000000000000000000"
        }
      ],
      "mode": "vest",
      "durationSeconds": 7776000
    }
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": {
    "enabled": false,
    "mode": "noOp"
  },
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["low", "medium", "high"]
    },
    "initializer": {
      "type": "standard"
    }
  }
}
```

## Solana create example

### Request

```http
POST /v1/solana/launches
x-api-key: <API_KEY>
Idempotency-Key: <UNIQUE_KEY>
content-type: application/json
```

```json
{
  "network": "devnet",
  "tokenMetadata": {
    "name": "My Solana Token",
    "symbol": "MSOL",
    "tokenURI": "ipfs://my-solana-token"
  },
  "economics": {
    "totalSupply": "1000000000"
  },
  "pricing": {
    "numerairePriceUsd": 150
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "xyk",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 100,
      "marketCapEndUsd": 1000
    },
    "curveFeeBps": 25,
    "allowBuy": true,
    "allowSell": true
  }
}
```

## Deployment modes and Redis

This repo currently supports two runtime modes:

- `standalone`: one API instance owns its own local state and does not need cross-instance coordination.
- `shared`: multiple API instances can serve the same workload safely by coordinating through Redis.

- Single-instance / standalone (`DEPLOYMENT_MODE=standalone`)
  - This is the default typed config mode and the simplest way to run the API.
  - `IDEMPOTENCY_BACKEND=file` is the default.
  - Redis is optional.
  - Good fit for one API instance, one signer, and a durable local filesystem.
  - Redis is still recommended if you want stronger idempotency recovery around crashes/restarts.
- Shared / multi-instance (`DEPLOYMENT_MODE=shared`)
  - Intended for horizontally scaled or production-style shared deployments.
  - `REDIS_URL` is required.
  - `IDEMPOTENCY_BACKEND` must be `redis`.
  - Create endpoints always require `Idempotency-Key` (`IDEMPOTENCY_REQUIRE_KEY=true` is enforced).
  - Rate-limit state is Redis-backed for cross-replica consistency.
  - Nonce submission uses a Redis-backed distributed signer lock for cross-replica coordination.
  - Redis-backed idempotency writes an `in_progress` marker before tx submit to close crash/restart duplicate windows.
  - Retries against a stuck `in_progress` marker fail closed with `409 IDEMPOTENCY_KEY_IN_DOUBT`; verify launch status before attempting a new key.
  - Redis in-flight lock uses a heartbeat; tune `IDEMPOTENCY_REDIS_LOCK_TTL_MS` to exceed max expected create duration.

`NODE_ENV=production` with no explicit `DEPLOYMENT_MODE` resolves to `shared`, so Redis becomes required in that case.

### Redis guidance

- Optional: single-instance / standalone deployments that use file-backed idempotency.
- Recommended: any deployment that wants stronger crash/restart recovery for create requests, even with one instance.
- Required: any shared deployment, multi-replica deployment, or any setup that explicitly sets `IDEMPOTENCY_BACKEND=redis`.

## Curve configuration examples

### Multicurve explicit ranges (non-preset)

Use this when you want deterministic, non-default market-cap bands instead of presets.

```json
{
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "ranges",
      "fee": 15000,
      "tickSpacing": 300,
      "curves": [
        {
          "marketCapStartUsd": 100,
          "marketCapEndUsd": 10000,
          "numPositions": 11,
          "sharesWad": "200000000000000000"
        },
        {
          "marketCapStartUsd": 10000,
          "marketCapEndUsd": 100000,
          "numPositions": 11,
          "sharesWad": "300000000000000000"
        },
        {
          "marketCapStartUsd": 100000,
          "marketCapEndUsd": "max",
          "numPositions": 11,
          "sharesWad": "500000000000000000"
        }
      ]
    }
  }
}
```

### Static explicit range (starts at $100)

Use this only for the static fallback path.

```json
{
  "auction": {
    "type": "static",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 100,
      "marketCapEndUsd": 100000
    }
  }
}
```

### Dynamic explicit range (starts at $100, uniswapV2 migration)

Use this for the V4 dynamic flow. Dynamic exits/migrates when `maxProceeds` is reached, or at auction end when `minProceeds` is satisfied.
Dynamic is intended for assets with well-known value that benefit from maximally capital-efficient price discovery.

```json
{
  "migration": {
    "type": "uniswapV2"
  },
  "auction": {
    "type": "dynamic",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 100,
      "marketCapMinUsd": 50,
      "minProceeds": "0.01",
      "maxProceeds": "0.1",
      "durationSeconds": 86400
    }
  }
}
```

### Success response (`200`)

```json
{
  "launchId": "84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "chainId": 84532,
  "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "statusUrl": "/v1/launches/84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "predicted": {
    "tokenAddress": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "poolId": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "gasEstimate": "12500000"
  },
  "effectiveConfig": {
    "tokensForSale": "800000000000000000000000",
    "allocationAmount": "200000000000000000000000",
    "allocationRecipient": "0x1111111111111111111111111111111111111111",
    "allocationRecipients": [
      {
        "address": "0x1111111111111111111111111111111111111111",
        "amount": "100000000000000000000000"
      },
      {
        "address": "0x2222222222222222222222222222222222222222",
        "amount": "100000000000000000000000"
      }
    ],
    "allocationLockMode": "vest",
    "allocationLockDurationSeconds": 7776000,
    "numeraireAddress": "0x4200000000000000000000000000000000000006",
    "numerairePriceUsd": 3000,
    "feeBeneficiariesSource": "default"
  }
}
```

### Solana success response (`200`)

```json
{
  "launchId": "8BD7a7kU4sASQ17S1X4Lw52dQWxwM8C2Y3jD7xA8fDzP",
  "network": "solanaDevnet",
  "signature": "5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J",
  "explorerUrl": "https://explorer.solana.com/tx/5M7wVJf4t1A6sM97CG8PcHqx6LwH7qQ6B27vZ37h7uPj7m9Yx4mQnBn1HX9gD4FVyMPRZ4Jrped1ZSmHgkmHGW4J?cluster=devnet",
  "predicted": {
    "tokenAddress": "6QWeT6FpJrm8AF1btu6WH2k2Xhq6t5vbheKVfQavmeoZ",
    "launchAuthorityAddress": "E7Ud4m8S7fC2YdUQdL7p9V2sRrMfQjQ9fA5spuR4T9gQ",
    "baseVaultAddress": "9xQeWvG816bUx9EPjHmaT23yvVMHh2eHq9cYqB9Yg6xT",
    "quoteVaultAddress": "J1veWvV6BF8L7rN8D66zCFAaj6MqFmoVoeAQMtkP8dwF"
  },
  "effectiveConfig": {
    "tokensForSale": "1000000000",
    "allocationAmount": "0",
    "baseForDistribution": "0",
    "baseForLiquidity": "0",
    "allocationLockMode": "none",
    "numeraireAddress": "So11111111111111111111111111111111111111112",
    "numerairePriceUsd": 150,
    "curveVirtualBase": "1000000000",
    "curveVirtualQuote": "100000000",
    "curveFeeBps": 25,
    "allowBuy": true,
    "allowSell": true,
    "tokenDecimals": 9
  }
}
```

## Status examples

### Pending (`200`)

```json
{
  "launchId": "84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "chainId": 84532,
  "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "pending",
  "confirmations": 0
}
```

### Confirmed (`200`)

```json
{
  "launchId": "84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "chainId": 84532,
  "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "confirmed",
  "confirmations": 2,
  "result": {
    "tokenAddress": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "poolOrHookAddress": "0xdddddddddddddddddddddddddddddddddddddddd",
    "poolId": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "blockNumber": "12345678"
  }
}
```

### Reverted (`200`)

```json
{
  "launchId": "84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "chainId": 84532,
  "txHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "reverted",
  "confirmations": 1,
  "error": {
    "code": "TX_REVERTED",
    "message": "Transaction reverted on-chain"
  }
}
```

## Capabilities example

### `GET /v1/capabilities` (`200`)

```json
{
  "defaultChainId": 84532,
  "pricing": {
    "enabled": true,
    "provider": "coingecko"
  },
  "chains": [
    {
      "chainId": 84532,
      "auctionTypes": ["multicurve", "dynamic"],
      "multicurveInitializers": ["standard", "scheduled", "decay", "rehype"],
      "migrationModes": ["noOp", "uniswapV2"],
      "governanceModes": ["noOp", "default"],
      "governanceEnabled": true
    }
  ],
  "solana": {
    "enabled": true,
    "supportedNetworks": ["solanaDevnet"],
    "unsupportedNetworks": ["solanaMainnetBeta"],
    "dedicatedRouteInputAliases": ["devnet", "mainnet-beta"],
    "creationOnly": true,
    "numeraireAddress": "So11111111111111111111111111111111111111112",
    "priceResolutionModes": ["request", "fixed", "coingecko"]
  }
}
```

## Health and readiness

- `GET /health`: process liveness
- `GET /ready`: dependency readiness (EVM chain RPC checks plus Solana readiness, requires `x-api-key`)
- `GET /metrics`: service metrics snapshot (requires `x-api-key`)
- degraded readiness checks return a generic error string (`"dependency unavailable"`) to avoid leaking upstream internals

Example `GET /health`:

```json
{ "status": "ok" }
```

## Validation and defaults

- Solana create-only rules:
  - use `POST /v1/solana/launches` or `POST /v1/launches` with `network: "solanaDevnet" | "solanaMainnetBeta"`
  - short Solana aliases are accepted only on the dedicated route
  - `launchId` is a launch PDA and no Solana `statusUrl` is returned
  - only WSOL is supported as numeraire
  - Solana rejects unsupported EVM-only fields instead of ignoring them
- `economics.baseForDistribution` and `economics.baseForLiquidity` are optional:
  - if omitted, both default to `0`
  - both must be u64 integer strings
  - their sum must be less than `totalSupply`
  - `tokensForSale = totalSupply - baseForDistribution - baseForLiquidity`
- Solana effective config reports:
  - `allocationAmount = baseForDistribution`
  - `baseForLiquidity` separately from distribution reserves
- Multicurve initializer:
  - default is `standard` (implemented as scheduled with `startTime=0`).
  - `scheduled` requires `auction.initializer.startTime`.
  - `decay` requires `startFee` and `durationSeconds` (optional `startTime`).
  - `rehype` requires hook config and percent wad fields that sum to `1e18`.
- Multicurve curve selection:
  - presets are convenient defaults.
  - explicit `ranges` are recommended when you need intentional market-cap bands instead of default tiers.
  - custom multicurve swap fees are supported via `curveConfig.fee` (custom values supported; tick spacing can be derived or provided).
- Static launch curve config:
  - `auction.type="static"` requires `auction.curveConfig`.
  - `curveConfig.type="preset"` supports `preset: "low" | "medium" | "high"`.
  - `curveConfig.type="range"` supports explicit `marketCapStartUsd` and `marketCapEndUsd`.
  - custom static fee input is supported via `curveConfig.fee`, but Uniswap V3 still enforces valid V3 fee tiers onchain.
  - static launches always use lockable beneficiaries (request values or default 95% user / 5% protocol owner).
  - use static only as a fallback when the target chain does not support Uniswap V4/multicurve.
- Dynamic launch curve config:
  - `auction.type="dynamic"` requires `auction.curveConfig`.
  - `curveConfig.type="range"` requires:
    - `marketCapStartUsd`
    - `marketCapMinUsd`
    - `minProceeds` (decimal string in numeraire units)
    - `maxProceeds` (decimal string in numeraire units)
  - optional: `durationSeconds`, `epochLengthSeconds`, `fee`, `tickSpacing`, `gamma`, `numPdSlugs`
  - custom dynamic fees are supported via `curveConfig.fee`.
  - dynamic launches require `migration.type="uniswapV2"` or `migration.type="uniswapV4"` in this API profile.
  - for `migration.type="uniswapV4"`, request `migration.fee` and `migration.tickSpacing`.
  - for `migration.type="uniswapV4"`, streamable fee beneficiaries are derived from `feeBeneficiaries` (or the default 95/5 split).
  - `migration.type="uniswapV3"` is reserved and currently returns `501 MIGRATION_NOT_IMPLEMENTED`.
- Percentage-based allocation is supported by converting percent to amount:
  - `tokensForSale = totalSupply * salePercent / 100`
  - Example: 20% sale means 80% non-market allocation.
- `integrationAddress` is optional.
- `governance` is binary at create time:
  - omitted/`false` => no governance
  - `true` or `{ "enabled": true }` => default token-holder governance (OpenZeppelin Governor via protocol governance factory)
- `pricing.numerairePriceUsd` overrides provider pricing.
- If auto-pricing is unavailable, caller must pass `pricing.numerairePriceUsd`.
- If `feeBeneficiaries` is omitted, API applies default split:
  - `userAddress`: 95%
  - protocol owner: 5%
- `feeBeneficiaries` request constraints:
  - supports up to `10` unique beneficiary addresses.
  - shares use WAD precision and must sum to `1e18` (100%) when protocol owner is included.
  - if protocol owner is omitted, provided shares must sum to `95%` (`0.95e18`) and API appends protocol owner at `5%`.
  - if protocol owner is provided, it must have at least `5%` (`WAD / 20`).

See `docs/mvp-launch.md` for a concise MVP launch example and a full defaults-resolution table.

## Tests

```bash
npm test
npm run test:static
npm run test:dynamic
npm run test:live
npm run test:live:static
npm run test:live:dynamic
npm run test:live:v2migration
npm run test:live:v4migration
npm run test:live:multicurve
npm run test:live:multicurve:defaults
npm run test:live:fees
npm run test:live:governance
npm run test:live:solana
npm run test:live:solana:devnet
npm run test:live:solana:defaults
npm run test:live:solana:random
npm run test:live:solana:failing
LIVE_TEST_VERBOSE=true npm run test:live
```

`test:live` performs real on-chain creation and verification when `LIVE_TEST_ENABLE=true` and funded credentials are configured.
By default, live output is concise (launch summary table). Set `LIVE_TEST_VERBOSE=true` for full per-launch parameter and verification tables.
Live launch tests run sequentially to avoid nonce conflicts from a single funded signer.
`test:live` remains the EVM baseline matrix; use `test:live:solana` or `test:live:solana:devnet` for the Solana devnet matrix.
Solana live tests require `SOLANA_ENABLED=true`, a funded `SOLANA_KEYPAIR`, reachable `SOLANA_DEVNET_RPC_URL` / `SOLANA_DEVNET_WS_URL`, and enough SOL for account creation; override the readiness estimate with `LIVE_TEST_MIN_BALANCE_SOL`, `LIVE_TEST_ESTIMATED_TX_COST_SOL`, and `LIVE_TEST_ESTIMATED_OVERHEAD_SOL` when needed.

## Lint, format, and git hooks

Tooling:

- `oxlint` (`oxlint.config.ts`) — fast Rust-based ESLint replacement.
- `oxfmt` (`oxfmt.config.ts`) — fast Rust-based Prettier replacement.
- `lefthook` (`lefthook.yml`) — runs the formatter, linter, and typecheck against staged files before each commit.

Both `oxlint.config.ts` and `oxfmt.config.ts` use `defineConfig` from their respective packages for full type-checking and editor autocomplete. TypeScript configs require Node ≥22.18 (covered by `.nvmrc` / `engines.node`).

Scripts:

```bash
npm run lint           # oxlint --deny-warnings
npm run lint:fix       # oxlint --fix
npm run format         # oxfmt (write)
npm run format:check   # oxfmt --check
npm run fix            # format + lint:fix
npm run check          # format:check + lint + typecheck + test
```

Git hooks (managed by [lefthook](https://lefthook.dev)):

- `pre-commit` — formats staged files with `oxfmt`, runs `oxlint --fix --deny-warnings` on staged JS/TS, restages fixed files, and runs `tsc --noEmit` when TypeScript files are staged.
- `pre-push` — runs `format:check`, `lint`, `typecheck`, and `test:unit` in parallel.

Hooks install automatically via the `prepare` script when running `npm install`. To install manually run `npx lefthook install`. To bypass for a single commit, use `git commit --no-verify` (discouraged).
