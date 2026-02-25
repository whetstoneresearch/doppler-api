# Custom Curve Guide

This API supports multicurve launch configuration in two modes:

1. Preset curves (`curveConfig.type = "preset"`)
2. Explicit ranges (`curveConfig.type = "ranges"`)

Recommendation:

- Use `ranges` for production launches when you need explicit market-cap behavior.
- Use `preset` only when the default low/medium/high tiers are intentionally acceptable.

Initializer modes are configured separately at `auction.initializer`:

- `standard` (default; implemented via scheduled initializer with `startTime=0`)
- `scheduled` (requires `startTime`)
- `decay` (requires `startFee`, `durationSeconds`; optional `startTime`)
- `rehype` (hook-based config for buyback/distribution behavior)

## Preset mode

Use curated tiers (`low`, `medium`, `high`) and optionally choose fee/tick spacing.

### Example

```json
{
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["low", "medium", "high"],
      "fee": 12000
    }
  }
}
```

### Tick spacing behavior

- If `tickSpacing` is provided, the API passes your value through.
- If `tickSpacing` is omitted:
  - Standard fee tiers use SDK defaults.
  - Custom fee tiers use API fallback derivation:
    - `tickSpacing ≈ round((fee / 100) * 2)`
    - For preset mode, the API additionally aligns spacing to preset tick compatibility.

## Ranges mode

Use explicit market-cap ranges and supply allocations (`sharesWad`).

Note: `sharesWad` controls allocation across market-cap curves inside the launch market.
Top-level sale allocation is configured separately with `economics.tokensForSale`:

- if omitted, 100% of supply is sold into the launch market
- if provided, the remainder is allocated to provided addresses with lock settings from
  `economics.allocations` (default 90-day vest)
- when split allocations are used, market allocation must still be at least 20% of total supply

### Requirements

- Curves must be contiguous/cohesive (`next.start == previous.end`).
- Shares must sum to `1e18` (`100%`).
- Use positive `numPositions`.
- `marketCapEndUsd` supports `"max"` in API payloads (internally resolved for SDK calls).

### Example

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
          "marketCapEndUsd": 250000,
          "numPositions": 11,
          "sharesWad": "300000000000000000"
        },
        {
          "marketCapStartUsd": 250000,
          "marketCapEndUsd": "max",
          "numPositions": 11,
          "sharesWad": "500000000000000000"
        }
      ]
    }
  }
}
```

## Full create payload example (ranges)

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "integrationAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Custom Curve Token",
    "symbol": "CCT",
    "tokenURI": "ipfs://custom-curve-token"
  },
  "economics": {
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
      "fee": 18000,
      "tickSpacing": 360,
      "curves": [
        {
          "marketCapStartUsd": 250,
          "marketCapEndUsd": 100000,
          "numPositions": 10,
          "sharesWad": "250000000000000000"
        },
        {
          "marketCapStartUsd": 100000,
          "marketCapEndUsd": 500000,
          "numPositions": 12,
          "sharesWad": "350000000000000000"
        },
        {
          "marketCapStartUsd": 500000,
          "marketCapEndUsd": "max",
          "numPositions": 12,
          "sharesWad": "400000000000000000"
        }
      ]
    }
  }
}
```
