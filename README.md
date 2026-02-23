# Doppler API

TypeScript REST API for creating Doppler launches.

## Disclaimer

This project is in active development & not ready for production use.

## Endpoints

- `POST /v1/launches`
- `POST /v1/launches/multicurve` (alias)
- `GET /v1/launches/:launchId`
- `GET /v1/capabilities`
- `GET /health`
- `GET /ready`

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

## Current target feature set

- Auction types:
  - `multicurve` (recommended default on V4-capable networks)
  - `static` (Uniswap V3 static launch with lockable beneficiaries; compatibility fallback for networks without Uniswap V4 support)
- Multicurve initializer modes:
  - `standard` (implemented via scheduled initializer with `startTime=0`)
  - `scheduled` (`startTime` required)
  - `decay` (`startFee`, `durationSeconds`, optional `startTime`)
  - `rehype` (hook-based initializer config)
- Migration mode: `noOp`
- Governance: `enabled=false` is the active profile, eg. `noOp`
- Token allocation profile:
  - Default: 100% of `totalSupply` is allocated to the multicurve market.
  - Optional: set `tokenomics.tokensForSale` to allocate less to the market.
  - Remainder (`totalSupply - tokensForSale`) is allocated to non-market allocation recipients.
  - Optional: set `tokenomics.allocations.recipients` (max 10 unique recipients) to split the non-market remainder.
  - Backward compatible alias: `tokenomics.allocations.allocations`.
- Multicurve design reference: [Doppler Multicurve whitepaper](https://doppler.lol/multicurve.pdf).
- Guidance: prefer `multicurve` whenever the target chain has Uniswap V4 support. Use `static` only when V4 is unavailable.

## Scope and roadmap

- Support for the rest of Doppler is coming soon
  - Dynamic price discovery auctions
  - Various other custom market dynamics

## Launch ID format

`<chainId>:<txHash>`

Example:
`84532:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

## Create launch example

### Request

```http
POST /v1/launches
x-api-key: <API_KEY>
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
  "tokenomics": {
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
      "auctionTypes": ["multicurve"],
      "multicurveInitializers": ["standard", "scheduled", "decay", "rehype"],
      "migrationModes": ["noOp"],
      "governanceModes": ["noOp"],
      "governanceEnabled": false
    }
  ]
}
```

## Health and readiness

- `GET /health`: process liveness
- `GET /ready`: dependency readiness (chain RPC checks)

Example `GET /health`:

```json
{ "status": "ok" }
```

## Validation and defaults

- `tokenomics.tokensForSale` is optional:
  - if omitted, `tokensForSale = totalSupply` (100% sold to market).
  - if provided, it must be `> 0` and `<= totalSupply`.
  - if `tokensForSale < totalSupply`, it must be at least `20%` of `totalSupply`.
- Non-market allocation is automatic:
  - `allocationAmount = totalSupply - tokensForSale`.
  - default recipient is `userAddress`.
  - default lock mode is `vest` for `90` days when non-market allocation exists.
  - lock modes: `vest`, `unlock`, `vault`.
- Optional explicit split across recipients:
  - `tokenomics.allocations.recipients` supports up to `10` unique allocation recipients.
  - legacy alias `tokenomics.allocations.allocations` is also accepted.
  - no duplicate addresses are allowed.
  - allocation amounts must sum exactly to `totalSupply - tokensForSale`.
  - if allocations are provided and `tokensForSale` is omitted, API derives `tokensForSale`.
- Multicurve initializer:
  - default is `standard` (implemented as scheduled with `startTime=0`).
  - `scheduled` requires `auction.initializer.startTime`.
  - `decay` requires `startFee` and `durationSeconds` (optional `startTime`).
  - `rehype` requires hook config and percent wad fields that sum to `1e18`.
- Multicurve curve selection:
  - presets are convenient defaults.
  - explicit `ranges` are recommended when you need intentional market-cap bands instead of default tiers.
- Static launch curve config:
  - `auction.type="static"` requires `auction.curveConfig`.
  - `curveConfig.type="preset"` supports `preset: "low" | "medium" | "high"`.
  - `curveConfig.type="range"` supports explicit `marketCapStartUsd` and `marketCapEndUsd`.
  - static launches always use lockable beneficiaries (request values or default 95% user / 5% protocol owner).
  - use static only as a fallback when the target chain does not support Uniswap V4/multicurve.
- Percentage-based allocation is supported by converting percent to amount:
  - `tokensForSale = totalSupply * salePercent / 100`
  - Example: 20% sale means 80% non-market allocation.
- `integrationAddress` is optional.
- `pricing.numerairePriceUsd` overrides provider pricing.
- If auto-pricing is unavailable, caller must pass `pricing.numerairePriceUsd`.
- If `feeBeneficiaries` is omitted, API applies default split:
  - `userAddress`: 95%
  - protocol owner: 5%

See `docs/mvp-launch.md` for a concise MVP launch example and a full defaults-resolution table.

## Tests

```bash
npm test
npm run test:static
npm run test:live
npm run test:live:static
npm run test:live:multicurve
npm run test:live:multicurve:defaults
npm run test:live --verbose
```

`test:live` performs real on-chain creation and verification when `LIVE_TEST_ENABLE=true` and funded credentials are configured.
By default, live output is concise (launch summary table). Use `--verbose` for full per-launch parameter and verification tables.
Live launch tests run sequentially to avoid nonce conflicts from a single funded signer.
