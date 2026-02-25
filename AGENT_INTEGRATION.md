# MVP Integration Guide

This is the shortest practical guide for integrating with the API from scripts, apps, or AI agents.

## 1. Start the API

```bash
npm install
cp .env.example .env
npm run dev
```

Container option:

```bash
cp .env.example .env
docker compose up --build
```

Base URL: `http://localhost:3000`

Use Node version from `.nvmrc` for local runs.

## 1b. Validation commands

```bash
npm test
npm run test:static
npm run test:dynamic
npm run test:live
npm run test:live:static
npm run test:live:dynamic
npm run test:live:multicurve
npm run test:live:multicurve:defaults
npm run test:live:governance
npm run test:live --verbose
```

- Live tests are concise by default and print a launch summary table.
- Add `--verbose` to print per-launch parameter + onchain verification tables.
- Live launch creation tests run sequentially to avoid nonce conflicts for one signer.

## 2. Required auth

Include API key header on launch/status routes:

- `x-api-key: <API_KEY>`

## 3. One launch flow

1. Call `POST /v1/launches`.
2. Save `launchId` from response.
3. Poll `GET /v1/launches/:launchId` every 3-5 seconds.
4. Stop when status is `confirmed` or `reverted`.

Auction selection guidance:

- Default to `auction.type="multicurve"` whenever the target chain supports Uniswap V4.
- Use `auction.type="dynamic"` only as a work-in-progress preview mode for well-known-value assets that need maximally capital-efficient V4 Dutch price discovery and should migrate to Uniswap V2 on success.
- Use `auction.type="static"` only for networks that do not support Uniswap V4.

Use `Idempotency-Key` on create requests in production integrations.

## 4. Minimal request template

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "My Token",
    "symbol": "MTK",
    "tokenURI": "ipfs://metadata"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
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

## 4b. Custom curve (ranges) template

Use this when you want intentional market-cap bands and allocation shares instead of preset tiers.

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Agent Curve Token",
    "symbol": "ACT",
    "tokenURI": "ipfs://agent-curve-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
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
          "marketCapEndUsd": 200000,
          "numPositions": 11,
          "sharesWad": "300000000000000000"
        },
        {
          "marketCapStartUsd": 200000,
          "marketCapEndUsd": "max",
          "numPositions": 11,
          "sharesWad": "500000000000000000"
        }
      ]
    }
  }
}
```

## 4c. Sale split template (20% sale / 80% non-market allocation)

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Split Token",
    "symbol": "SPL",
    "tokenURI": "ipfs://split-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000",
    "tokensForSale": "200000000000000000000000",
    "allocations": {
      "mode": "vest",
      "durationSeconds": 7776000
    }
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["medium"]
    }
  }
}
```

## 4d. Multi-address non-market allocation template

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Team Split Token",
    "symbol": "TST",
    "tokenURI": "ipfs://team-split-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000",
    "allocations": {
      "recipients": [
        {
          "address": "0x2222222222222222222222222222222222222222",
          "amount": "300000000000000000000000"
        },
        {
          "address": "0x3333333333333333333333333333333333333333",
          "amount": "500000000000000000000000"
        }
      ],
      "mode": "vest",
      "durationSeconds": 7776000
    }
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["medium"]
    }
  }
}
```

## 4e. Static (V3) launch template

Use this only when the target network does not support Uniswap V4/multicurve.
For V4-capable networks, use the multicurve templates above.

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static Token",
    "symbol": "STC",
    "tokenURI": "ipfs://static-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "static",
    "curveConfig": {
      "type": "preset",
      "preset": "medium"
    }
  }
}
```

## 4f. Static (V3) explicit range template (starts at $100)

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static Range Token",
    "symbol": "SRT",
    "tokenURI": "ipfs://static-range-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
  "migration": {
    "type": "noOp"
  },
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

## 4g. Dynamic (V4) explicit range template (starts at $100)

Use this for the MVP dynamic flow on Base Sepolia with Uniswap V2 migration.
Dynamic pools migrate immediately when `maxProceeds` is reached, or at auction end when `minProceeds` is reached.
This mode is intended for assets with well-known value and maximally capital-efficient price discovery goals.
Dynamic creation is currently work in progress and should be treated as preview behavior.

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Dynamic Token",
    "symbol": "DYN",
    "tokenURI": "ipfs://dynamic-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 3000
  },
  "governance": false,
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

Custom-curve rules agents should enforce before submit:

- Use 3-4 curves for most launches.
- Keep curves cohesive (`next.start == previous.end`).
- Ensure shares sum to `1e18` (100%).
- Keep `numPositions > 0`.

## 5. What to expect in create response

- `launchId`: stable tracking key (`<chainId>:<txHash>`)
- `txHash`: onchain tx hash
- `predicted.tokenAddress` and `predicted.poolId`: simulation outputs
- `effectiveConfig`: defaults actually used by API

## 6. Status handling rules

- `pending`: continue polling.
- `confirmed`: use `result.tokenAddress` and `result.poolId`.
- `reverted`: treat as failed launch and surface `error.code/message`.
- `not_found`: retry briefly, then fail.

## 7. Important defaults

- `tokenomics.tokensForSale` defaults to `totalSupply`.
- if `tokensForSale < totalSupply`, market sale must be at least 20% of total supply.
- Multicurve initializer defaults to `standard` (implemented as scheduled with `startTime=0`).
- Supported multicurve initializer modes:
  - `standard`
  - `scheduled` with required `startTime`
  - `decay` with `startFee`, `durationSeconds`, optional `startTime`
  - `rehype` with hook config and wad distribution fields
- Static launches require `auction.curveConfig`:
  - `type: "preset"` with `preset: "low" | "medium" | "high"`
  - or `type: "range"` with explicit `marketCapStartUsd` and `marketCapEndUsd`
- Static launches use lockable beneficiaries and `migration.type="noOp"` only in this API profile.
- Dynamic launches require:
  - dynamic creation is currently work in progress (preview) and may change
  - `auction.curveConfig.type = "range"`
  - `marketCapStartUsd`, `marketCapMinUsd`, `minProceeds`, `maxProceeds`
  - `migration.type="uniswapV2"` (required in this API profile)
- `migration.type="uniswapV3"` is not supported and currently returns `501 MIGRATION_NOT_IMPLEMENTED`.
- `migration.type="uniswapV4"` is planned and currently returns `501 MIGRATION_NOT_IMPLEMENTED`.
- Agent policy: multicurve is the default and preferred auction type. Choose static only as a compatibility fallback for non-V4 networks.
- Prefer multicurve `curveConfig.type="ranges"` when you need specific market-cap behavior; do not default to presets unless generic tiers are acceptable.
- Non-market allocation is computed automatically:
  - `allocationAmount = totalSupply - tokensForSale`
  - default recipient is `userAddress`
  - default lock mode is `vest`
  - default lock duration is `7776000` seconds (90 days)
- Explicit allocation split:
  - use `tokenomics.allocations.recipients` for up to 10 unique addresses
  - legacy alias `tokenomics.allocations.allocations` is also accepted
  - no duplicate addresses
  - amounts must sum exactly to `totalSupply - tokensForSale`
  - if `tokensForSale` is omitted, API derives it from allocation amounts
- Supported non-market allocation lock modes:
  - `vest` (duration > 0)
  - `unlock` (duration omitted or `0`)
  - `vault` (duration > 0)
- Percentage-based sale setup:
  - compute `tokensForSale = totalSupply * salePercent / 100`
  - example: `salePercent=20` => 20% sold in auction, 80% non-market allocation
- `governance` defaults to `false` (no governance) when omitted.
- `governance` is binary at create time:
  - `false` or omitted => no governance
  - `true` or `{ enabled: true }` => default token-holder governance (OpenZeppelin Governor via protocol governance factory)
- `integrationAddress` is optional.
- If `feeBeneficiaries` is omitted, API defaults to 95% user / 5% protocol owner.
- If no price provider is available, you must pass `pricing.numerairePriceUsd`.
- For custom multicurve fees with omitted `tickSpacing`, API derives fallback spacing.

## 8. Copy/paste curl

Create:

```bash
curl -X POST http://localhost:3000/v1/launches \
  -H 'content-type: application/json' \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: launch-$(date +%s)" \
  -d @launch.json
```

Status:

```bash
curl -H "x-api-key: $API_KEY" \
  "http://localhost:3000/v1/launches/$LAUNCH_ID"
```

Capabilities:

```bash
curl http://localhost:3000/v1/capabilities
```

## 9. Docs for agents

For full contract details and schema references:

- `docs/openapi.yaml` (machine-readable)
- `docs/api-reference.md`
- `docs/custom-curves.md`
- `docs/mvp-launch.md`
- `docs/errors.md`
