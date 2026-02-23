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
npm run test:live
npm run test:live -- --verbose
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
    }
  }
}
```

## 4b. Custom curve (ranges) template

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
      "allocations": [
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
- Non-market allocation is computed automatically:
  - `allocationAmount = totalSupply - tokensForSale`
  - default recipient is `userAddress`
  - default lock mode is `vest`
  - default lock duration is `7776000` seconds (90 days)
- Explicit allocation split:
  - use `tokenomics.allocations.allocations` for up to 10 unique addresses
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
- `governance` defaults to `false` (no-op) when omitted.
- `governance: true` is currently unsupported and returns `501 GOVERNANCE_NOT_IMPLEMENTED`.
- `governance: { enabled: false, mode: "custom" }` is currently unsupported and returns `501 GOVERNANCE_NOT_IMPLEMENTED`.
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
