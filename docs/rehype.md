# Rehype Guide

Rehype is available in two EVM launch paths:

- Every multicurve launch uses a Rehype initializer.
- A dynamic launch with a Uniswap V4 migration can add Rehype migrator configuration.

Send either request through the shared EVM launch route, `POST /v1/launches`, or through its family-specific route: `POST /v1/launches/multicurve` or `POST /v1/launches/dynamic`. See [Launch Request Examples](launch-examples.md) for complete request bodies.

## Multicurve initializer

Every multicurve request includes `auction.initializer`. The initializer object is the Rehype configuration itself: it has no `type` discriminator and no nested `config` object.

The initializer requires `startFee`, `feeDistributionInfo`, and exactly one of `buybackDestination` or `rehypeFeeBeneficiaries`.

### Direct buyback routing

Set a non-zero `buybackDestination`:

```json
{
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
```

### Beneficiary routing

Set `rehypeFeeBeneficiaries` instead of `buybackDestination`:

```json
{
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
      "address": "0x3333333333333333333333333333333333333333",
      "sharesWad": "400000000000000000"
    },
    {
      "address": "0x4444444444444444444444444444444444444444",
      "sharesWad": "600000000000000000"
    }
  ]
}
```

The list contains one to 10 case-insensitively unique, non-zero EVM addresses. Each `sharesWad` is a positive integer string, and the list totals `1000000000000000000`.

Rehype beneficiaries route hook fees independently of top-level `poolFeeBeneficiaries`. Rehype reserves the Airlock owner's protocol fee before applying the beneficiary shares, so the list does not add an owner entry merely to account for that fee.

### Fee schedule

| Field | Required | Rules |
| --- | --- | --- |
| `startFee` | Yes | Integer from `0` through `800000`. |
| `endFee` | No | Integer from `0` through `800000` and no greater than `startFee`. It equals `startFee` when omitted. |
| `durationSeconds` | No | Unsigned 32-bit integer. It is greater than zero when `startFee` exceeds `endFee`; it may be zero or omitted for a constant fee. |
| `startingTime` | No | Unsigned 32-bit start time in seconds. |

### Fee distribution

`feeDistributionInfo` contains four weights for fees collected in the asset and four weights for fees collected in the numeraire:

- `assetFeesToAssetBuybackWad`
- `assetFeesToNumeraireBuybackWad`
- `assetFeesToBeneficiaryWad`
- `assetFeesToLpWad`
- `numeraireFeesToAssetBuybackWad`
- `numeraireFeesToNumeraireBuybackWad`
- `numeraireFeesToBeneficiaryWad`
- `numeraireFeesToLpWad`

Every value is a non-negative integer string. The four `assetFeesTo*` values total `1000000000000000000`, and the four `numeraireFeesTo*` values independently total the same amount.

## Dynamic Uniswap V4 migration

A dynamic request can select the Rehype migrator by adding `rehype` to its required Uniswap V4 migration. This is a `migration` value:

```json
{
  "type": "uniswapV4",
  "fee": 3000,
  "tickSpacing": 60,
  "lockDurationSeconds": 604800,
  "rehype": {
    "buybackDestination": "0x2222222222222222222222222222222222222222",
    "customFee": 10000,
    "feeRoutingMode": "directBuyback",
    "feeDistributionInfo": {
      "assetFeesToAssetBuybackWad": "250000000000000000",
      "assetFeesToNumeraireBuybackWad": "250000000000000000",
      "assetFeesToBeneficiaryWad": "250000000000000000",
      "assetFeesToLpWad": "250000000000000000",
      "numeraireFeesToAssetBuybackWad": "250000000000000000",
      "numeraireFeesToNumeraireBuybackWad": "250000000000000000",
      "numeraireFeesToBeneficiaryWad": "250000000000000000",
      "numeraireFeesToLpWad": "250000000000000000"
    }
  }
}
```

Migrator-side Rehype requires:

- `buybackDestination`: a non-zero EVM address.
- `customFee`: the static Rehype hook fee, as an integer from `0` through `1000000`.
- `feeDistributionInfo`: the same eight-field matrix and independent WAD row totals used by the initializer.

The optional `feeRoutingMode` accepts both modes:

- `directBuyback` is the default and selects direct-buyback routing.
- `routeToBeneficiaryFees` accrues hook fees for collection by `buybackDestination`. It does not route them through top-level `poolFeeBeneficiaries`.

Migrator-side Rehype uses a static `customFee`; it does not use the initializer fee schedule or a Rehype beneficiary list. The top-level migration `fee` remains the fixed Uniswap V4 LP fee. Dynamic Uniswap V2 migrations do not accept Rehype configuration.
