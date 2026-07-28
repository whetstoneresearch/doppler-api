# Launch Request Examples and Defaults

These complete EVM request bodies use Base Sepolia (`chainId: 84532`) and an explicit numeraire price. Replace the illustrative addresses, metadata, price, and chain for your launch.

Every body works on the shared EVM launch route, `POST /v1/launches`, and on the listed family-specific route. Save a JSON block as `request.json`, then send it with:

```bash
curl --request POST 'http://localhost:3000/v1/launches' \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-api-key' \
  --header 'Idempotency-Key: replace-with-unique-key' \
  --data @request.json
```

## Supported-family example matrix

| Example | Family | Shared EVM launch route | Family-specific route |
| --- | --- | --- | --- |
| [Minimal Rehype multicurve](#minimal-rehype-multicurve) | `multicurve` | `POST /v1/launches` | `POST /v1/launches/multicurve` |
| [Multicurve custom ranges](#multicurve-custom-ranges) | `multicurve` | `POST /v1/launches` | `POST /v1/launches/multicurve` |
| [Multicurve allocations and vesting](#multicurve-allocations-and-vesting) | `multicurve` | `POST /v1/launches` | `POST /v1/launches/multicurve` |
| [Static preset](#static-preset) | `static` | `POST /v1/launches` | `POST /v1/launches/static` |
| [Static range](#static-range) | `static` | `POST /v1/launches` | `POST /v1/launches/static` |
| [Dynamic Uniswap V2](#dynamic-uniswap-v2) | `dynamic` | `POST /v1/launches` | `POST /v1/launches/dynamic` |
| [Dynamic Uniswap V4](#dynamic-uniswap-v4) | `dynamic` | `POST /v1/launches` | `POST /v1/launches/dynamic` |
| [Dynamic Rehype migration](#dynamic-rehype-migration) | `dynamic` | `POST /v1/launches` | `POST /v1/launches/dynamic` |

## Multicurve

Every multicurve request includes a flattened Rehype `auction.initializer`. See the [Rehype Guide](rehype.md) for fee schedules, distribution rules, and the two exclusive routing forms.

### Minimal Rehype multicurve

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Minimal Rehype Token",
    "symbol": "MINR",
    "tokenURI": "ipfs://minimal-rehype-token"
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
}
```

Omitting `endFee` makes it equal to `startFee`, so this example uses a constant Rehype hook fee.

### Multicurve custom ranges

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Custom Range Token",
    "symbol": "RANGE",
    "tokenURI": "ipfs://custom-range-token"
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
      "type": "ranges",
      "fee": 3000,
      "curves": [
        {
          "marketCapStartUsd": 10000,
          "marketCapEndUsd": 50000,
          "numPositions": 8,
          "sharesWad": "400000000000000000"
        },
        {
          "marketCapStartUsd": 50000,
          "marketCapEndUsd": 250000,
          "numPositions": 12,
          "sharesWad": "350000000000000000"
        },
        {
          "marketCapStartUsd": 250000,
          "marketCapEndUsd": "max",
          "numPositions": 20,
          "sharesWad": "250000000000000000"
        }
      ]
    },
    "initializer": {
      "startFee": 3000,
      "endFee": 500,
      "durationSeconds": 86400,
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
}
```

The ranges are contiguous, the final range alone uses `"max"`, and the curve shares total `1000000000000000000`.

### Multicurve allocations and vesting

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Vested Token",
    "symbol": "VEST",
    "tokenURI": "ipfs://vested-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000",
    "tokensForSale": "800000000000000000000000",
    "allocations": [
      {
        "recipientAddress": "0x3333333333333333333333333333333333333333",
        "amount": "100000000000000000000000",
        "durationSeconds": 7776000
      },
      {
        "recipientAddress": "0x4444444444444444444444444444444444444444",
        "amount": "100000000000000000000000",
        "durationSeconds": 15552000,
        "cliffDurationSeconds": 2592000
      }
    ]
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
        "assetFeesToAssetBuybackWad": "0",
        "assetFeesToNumeraireBuybackWad": "0",
        "assetFeesToBeneficiaryWad": "1000000000000000000",
        "assetFeesToLpWad": "0",
        "numeraireFeesToAssetBuybackWad": "0",
        "numeraireFeesToNumeraireBuybackWad": "0",
        "numeraireFeesToBeneficiaryWad": "1000000000000000000",
        "numeraireFeesToLpWad": "0"
      },
      "rehypeFeeBeneficiaries": [
        {
          "address": "0x5555555555555555555555555555555555555555",
          "sharesWad": "400000000000000000"
        },
        {
          "address": "0x6666666666666666666666666666666666666666",
          "sharesWad": "600000000000000000"
        }
      ]
    }
  }
}
```

The allocation amounts exactly equal `totalSupply - tokensForSale`. Allocation entries are vesting schedules, so the same recipient can appear more than once with different durations.

## Static

### Static preset

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static Preset Token",
    "symbol": "SPT",
    "tokenURI": "ipfs://static-preset-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 2500
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

### Static range

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Static Range Token",
    "symbol": "SRT",
    "tokenURI": "ipfs://static-range-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 2500
  },
  "auction": {
    "type": "static",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 25000,
      "marketCapEndUsd": 250000,
      "fee": 3000,
      "numPositions": 20
    }
  }
}
```

Static requests do not accept `migration` or `auction.initializer`.

## Dynamic

### Dynamic Uniswap V2

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Dynamic V2 Token",
    "symbol": "DV2",
    "tokenURI": "ipfs://dynamic-v2-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 2500
  },
  "migration": {
    "type": "uniswapV2",
    "feeBeneficiary": {
      "address": "0x2222222222222222222222222222222222222222",
      "percentage": 25
    }
  },
  "auction": {
    "type": "dynamic",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 500000,
      "marketCapMinUsd": 50000,
      "minProceeds": "10",
      "maxProceeds": "1000"
    }
  }
}
```

Uniswap V2 uses its singular migration `feeBeneficiary` and does not accept top-level `poolFeeBeneficiaries`.

### Dynamic Uniswap V4

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Dynamic V4 Token",
    "symbol": "DV4",
    "tokenURI": "ipfs://dynamic-v4-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 2500
  },
  "migration": {
    "type": "uniswapV4",
    "fee": 3000,
    "tickSpacing": 60,
    "lockDurationSeconds": 604800
  },
  "auction": {
    "type": "dynamic",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 500000,
      "marketCapMinUsd": 50000,
      "minProceeds": "10",
      "maxProceeds": "1000"
    }
  }
}
```

The migration `fee` is the fixed Uniswap V4 LP fee.

### Dynamic Rehype migration

```json
{
  "chainId": 84532,
  "userAddress": "0x1111111111111111111111111111111111111111",
  "tokenMetadata": {
    "name": "Dynamic Rehype Token",
    "symbol": "DRH",
    "tokenURI": "ipfs://dynamic-rehype-token"
  },
  "economics": {
    "totalSupply": "1000000000000000000000000"
  },
  "pricing": {
    "numerairePriceUsd": 2500
  },
  "migration": {
    "type": "uniswapV4",
    "fee": 3000,
    "tickSpacing": 60,
    "lockDurationSeconds": 604800,
    "rehype": {
      "buybackDestination": "0x2222222222222222222222222222222222222222",
      "customFee": 10000,
      "feeRoutingMode": "routeToBeneficiaryFees",
      "feeDistributionInfo": {
        "assetFeesToAssetBuybackWad": "500000000000000000",
        "assetFeesToNumeraireBuybackWad": "500000000000000000",
        "assetFeesToBeneficiaryWad": "0",
        "assetFeesToLpWad": "0",
        "numeraireFeesToAssetBuybackWad": "0",
        "numeraireFeesToNumeraireBuybackWad": "250000000000000000",
        "numeraireFeesToBeneficiaryWad": "250000000000000000",
        "numeraireFeesToLpWad": "500000000000000000"
      }
    }
  },
  "auction": {
    "type": "dynamic",
    "curveConfig": {
      "type": "range",
      "marketCapStartUsd": 500000,
      "marketCapMinUsd": 50000,
      "minProceeds": "10",
      "maxProceeds": "1000"
    }
  }
}
```

`migration.rehype.customFee` is a static hook fee separate from the top-level Uniswap V4 LP `fee`. See the [Rehype Guide](rehype.md) for both migrator fee routing modes.

## Defaults and shared behavior

- `chainId` may be omitted only when the deployment configures `DEFAULT_CHAIN_ID`; otherwise it is required.
- An explicit `pricing.numerairePriceUsd` bypasses the configured price provider. Without it, the deployment resolves the numeraire price through its configured provider.
- Omitting both `tokensForSale` and `allocations` sells the full supply through the market. When explicit allocations are present and `tokensForSale` is omitted, the API derives the sale amount as `totalSupply` minus their sum.
- When `tokensForSale` is less than `totalSupply` and `allocations` is omitted, the remainder receives the default 90-day vesting schedule for `userAddress`. Explicit allocations contain one to 10 schedules, last for at least one day, and total the non-market remainder.
- Omitted EVM governance and `false` select `noOp`; `true` selects `default`; an EVM address selects `custom` governance with that address as the multisig.
- Omitted top-level `poolFeeBeneficiaries` uses the default 95% user and 5% protocol-owner pool-fee split where the family supports pool beneficiaries.
- Multicurve accepts only its required Rehype initializer. Static and multicurve requests do not accept a migration. Dynamic requests require exactly one Uniswap V2 or Uniswap V4 migration.
- Request objects reject unknown fields. Integer-string and WAD fields contain decimal digits only.

For curve field constraints and more inline configurations, see the [Custom Curve Guide](custom-curves.md). For the exact machine-readable contract, see the [OpenAPI specification](openapi.yaml).
