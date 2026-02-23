# MVP Launch Examples And Defaults

This file shows:

1. A minimal MVP launch request.
2. The defaults the API fills in.
3. An optional explicit allocation split request.
4. A minimal static (V3) launch request (fallback only for non-V4 networks).
5. A static explicit-range request (starting at $100).

## 1) Minimal MVP launch request

```json
{
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "MVP Token",
    "symbol": "MVP",
    "tokenURI": "ipfs://mvp-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["medium"]
    },
    "initializer": {
      "type": "standard"
    }
  }
}
```

## 2) Defaults populated for minimal request

| Field                           | Populated value                           |
| ------------------------------- | ----------------------------------------- |
| `chainId`                       | `DEFAULT_CHAIN_ID`                        |
| `integrationAddress`            | omitted                                   |
| `pricing.numerairePriceUsd`     | resolved from pricing provider if enabled |
| `governance`                    | `false` / no-op                           |
| `tokenomics.tokensForSale`      | `tokenomics.totalSupply`                  |
| `allocationAmount`              | `0`                                       |
| `allocationRecipient`           | `userAddress`                             |
| `allocationLockMode`            | `none`                                    |
| `allocationLockDurationSeconds` | `0`                                       |
| `allocationRecipients`          | `[]`                                      |

This is the default fair-launch behavior (100% of supply sold through Doppler market).

## 3) Optional explicit allocation split

Use this when you want non-market supply split across specific addresses.

```json
{
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Split Token",
    "symbol": "SPLIT",
    "tokenURI": "ipfs://split-token"
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
  "migration": {
    "type": "noOp"
  },
  "auction": {
    "type": "multicurve",
    "curveConfig": {
      "type": "preset",
      "presets": ["medium"]
    },
    "initializer": {
      "type": "standard"
    }
  }
}
```

Validation rules for explicit split:

- Up to 10 unique addresses.
- No duplicate addresses.
- Allocation amounts must be positive integers.
- Amounts must sum exactly to `totalSupply - tokensForSale`.
- If `tokensForSale` is omitted, API derives it from allocation sums.
- Market sale must be at least 20% of total supply.

## 4) Minimal static (V3) launch request

```json
{
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static MVP Token",
    "symbol": "SMVP",
    "tokenURI": "ipfs://static-mvp-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
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

Static request notes:

- `auction.curveConfig` is required for static launches.
- `preset` supports `low`, `medium`, `high`.
- Static launches use lockable beneficiaries (request list or default 95% user / 5% protocol owner).
- Use static only when the target chain does not support Uniswap V4 multicurve launches.

## 5) Static explicit range request (starts at $100)

```json
{
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static Range Token",
    "symbol": "SRT",
    "tokenURI": "ipfs://static-range-token"
  },
  "tokenomics": {
    "totalSupply": "1000000000000000000000000"
  },
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

If you need explicit market-cap shaping on multicurve, use `auction.curveConfig.type = "ranges"` with contiguous bands instead of presets.
