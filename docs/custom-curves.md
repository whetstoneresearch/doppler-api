# Custom Curve Guide

This guide covers `auction.curveConfig` for each EVM auction family. Each curve configuration rejects unknown fields. See [Launch Request Examples](launch-examples.md) for complete request bodies and the [Rehype Guide](rehype.md) for initializer and migration configuration.

## Static

Set `auction.type` to `"static"` and use one of these `auction.curveConfig` shapes.

### Preset

```json
{
  "type": "preset",
  "preset": "medium",
  "fee": 3000,
  "numPositions": 20,
  "maxShareToBeSoldWad": "800000000000000000"
}
```

`preset` is `"low"`, `"medium"`, or `"high"`.

### Manual range

```json
{
  "type": "range",
  "marketCapStartUsd": 25000,
  "marketCapEndUsd": 250000,
  "fee": 3000,
  "numPositions": 20,
  "maxShareToBeSoldWad": "800000000000000000"
}
```

Both market caps are positive, and `marketCapEndUsd` exceeds `marketCapStartUsd`.

Both static shapes accept these optional fields:

- `fee`: one of `100`, `500`, `3000`, or `10000`.
- `numPositions`: a positive integer no greater than `65535`.
- `maxShareToBeSoldWad`: a positive integer string no greater than `1000000000000000000`.

Static requests do not accept `migration` or `auction.initializer`.

## Multicurve

Set `auction.type` to `"multicurve"` and use one of these `auction.curveConfig` shapes.

### Presets

```json
{
  "type": "preset",
  "presets": ["low", "medium", "high"],
  "fee": 3000
}
```

The optional `presets` array contains `"low"`, `"medium"`, and `"high"` values. When `tickSpacing` is omitted, the API selects the largest spacing no greater than the fee-tier default that divides every selected preset boundary.

### Custom ranges

```json
{
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
}
```

Custom ranges follow these rules:

- `curves` is non-empty.
- Every curve has a positive `marketCapStartUsd`, a `numPositions` integer from `1` through `65535`, and a positive integer-string `sharesWad`.
- `marketCapEndUsd` is a positive number greater than the range start or `"max"`.
- Numeric ranges are contiguous. Only the final range can use `"max"`.
- All `sharesWad` values total `1000000000000000000`.

Both multicurve shapes accept an integer `fee` from `0` through `100000` and an integer `tickSpacing` from `1` through `32767`. For custom ranges, a standard fee tier uses the SDK default spacing; a custom fee derives a spacing unless the request supplies one.

Every multicurve request also includes the required flattened Rehype `auction.initializer` described in the [Rehype Guide](rehype.md). Multicurve requests do not accept `migration`.

## Dynamic

Set `auction.type` to `"dynamic"`. Dynamic auctions use this range `auction.curveConfig` shape:

```json
{
  "type": "range",
  "marketCapStartUsd": 500000,
  "marketCapMinUsd": 50000,
  "minProceeds": "10",
  "maxProceeds": "1000",
  "durationSeconds": 3600,
  "epochLengthSeconds": 60,
  "fee": 3000,
  "tickSpacing": 30,
  "gamma": 300,
  "numPdSlugs": 5
}
```

The required fields follow these rules:

- `marketCapStartUsd` and `marketCapMinUsd` are positive, and `marketCapMinUsd` is less than `marketCapStartUsd`.
- `minProceeds` and `maxProceeds` are canonical non-negative decimal strings without leading zeros and with at most 18 decimal places. Their values in 18-decimal units cannot exceed `uint256`; the largest value is `115792089237316195423570985008687907853269984665640564039457.584007913129639935`. `maxProceeds` is greater than zero, and `minProceeds` does not exceed it.

The optional fields follow these rules:

- `durationSeconds` and `epochLengthSeconds` are positive safe integers. After defaults are applied, `epochLengthSeconds` divides `durationSeconds` evenly.
- `fee` is an integer from `0` through `100000`. A fee other than `100`, `500`, `3000`, or `10000` requires an explicit `tickSpacing`.
- `tickSpacing` is a positive safe integer no greater than `30`.
- `gamma` is a positive integer no greater than `8388607` and is divisible by the effective `tickSpacing`.
- `numPdSlugs` is a positive integer no greater than `15`.

Dynamic requests also require a top-level Uniswap V2 or Uniswap V4 `migration`. See the dynamic examples in [Launch Request Examples](launch-examples.md). Rehype migration configuration belongs in the [Rehype Guide](rehype.md), not in the curve object.
