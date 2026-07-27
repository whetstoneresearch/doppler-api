# Custom Curve Guide

Curve and initializer objects reject unknown fields. See `docs/openapi.yaml` for
complete request examples.

## Static

Set `auction.type` to `"static"` and choose one curve configuration:

- A preset requires `type: "preset"` and `preset: "low"`, `"medium"`, or
  `"high"`.
- A manual range requires `type: "range"`, positive `marketCapStartUsd` and
  `marketCapEndUsd`, and an end market cap greater than the start market cap.

Both configurations accept these optional fields:

- `fee`: one of `100`, `500`, `3000`, or `10000`.
- `numPositions`: a positive integer.
- `maxShareToBeSoldWad`: a positive integer string.

Static requests do not accept `migration`.

## Multicurve

Set `auction.type` to `"multicurve"` and choose one curve configuration:

- A preset uses `type: "preset"`. The optional `presets` array may contain
  `"low"`, `"medium"`, and `"high"`.
- Custom ranges use `type: "ranges"` and a non-empty `curves` array. Each curve
  requires positive `marketCapStartUsd`, positive integer `numPositions`, and
  a positive integer-string `sharesWad`. `marketCapEndUsd` is either a
  positive number greater than the range start or `"max"`. Numeric ranges must
  be contiguous, `"max"` is valid only on the final range, and all
  `sharesWad` values must total `1000000000000000000`.

Both configurations accept an integer `fee` from `0` through `100000` and a
positive integer `tickSpacing`. Multicurve requests do not accept `migration`.

Omit `initializer` or set it to `{ "type": "standard" }` for the standard
initializer. To use Rehype, set `initializer.type` to `"rehype"` and provide
`initializer.config`.

### Rehype configuration

`startFee` and `feeDistributionInfo` are required. `startFee` is an integer
from `0` through `800000`. Optional `endFee` has the same range and cannot
exceed `startFee`; when it is lower than `startFee`, `durationSeconds` must be
greater than zero. `durationSeconds` and `startingTime` are optional integers
from `0` through `4294967295`.

`feeDistributionInfo` contains these eight non-negative integer strings:

- `assetFeesToAssetBuybackWad`
- `assetFeesToNumeraireBuybackWad`
- `assetFeesToBeneficiaryWad`
- `assetFeesToLpWad`
- `numeraireFeesToAssetBuybackWad`
- `numeraireFeesToNumeraireBuybackWad`
- `numeraireFeesToBeneficiaryWad`
- `numeraireFeesToLpWad`

The four `assetFeesTo*` values must total `1000000000000000000`, and the four
`numeraireFeesTo*` values must independently total the same amount.

Provide exactly one fee destination:

- `buybackDestination`: a non-zero EVM address.
- `rehypeFeeBeneficiaries`: 1 to 10 entries with case-insensitively unique,
  non-zero EVM addresses and positive integer-string `sharesWad` values. The
  shares must total `1000000000000000000`.

Rehype beneficiaries receive hook fees and are separate from top-level
`poolFeeBeneficiaries`. The API does not add the Airlock owner to the Rehype
list because the hook reserves the owner's protocol fee separately. Top-level
pool beneficiaries continue to require the protocol owner's minimum 5% share.

The remaining optional Rehype fields are:

- `graduationCalldata`: hex bytes beginning with `0x`.
- `graduationMarketCap`: a positive number.
- `numerairePrice`: a positive number.
- `farTick`: an integer from `-8388608` through `8388607`.

Do not provide both `graduationMarketCap` and `farTick`.

## Dynamic

Set `auction.type` to `"dynamic"` and
`auction.curveConfig.type` to `"range"`. The curve requires:

- Positive `marketCapStartUsd` and `marketCapMinUsd`, with
  `marketCapMinUsd` less than `marketCapStartUsd`.
- `minProceeds` and `maxProceeds` as non-negative decimal strings with at most
  18 decimal places. `maxProceeds` must be greater than zero, and
  `minProceeds` cannot exceed it.

Optional curve fields follow these rules:

- `durationSeconds` and `epochLengthSeconds` are positive safe integers. After
  defaults are applied, `epochLengthSeconds` must divide `durationSeconds`
  evenly.
- `fee` is an integer from `0` through `100000`. A fee other than `100`, `500`,
  `3000`, or `10000` requires an explicit `tickSpacing`.
- `tickSpacing` is a positive safe integer no greater than `30`.
- `gamma` is a positive safe integer divisible by the effective
  `tickSpacing`.
- `numPdSlugs` is a positive safe integer.

Dynamic requests require a `migration`:

- `uniswapV2` accepts only an optional
  `feeBeneficiary: { address, percentage }`. The address must be non-zero, and
  `percentage` must be an integer from `1` through `50`. Do not provide
  top-level `poolFeeBeneficiaries` with this migration.
- `uniswapV4` requires an integer `fee` from `0` through `150000`, a positive
  integer `tickSpacing`, and an integer `lockDurationSeconds` from `0` through
  `4294967295`. The resulting Uniswap V4 pool uses this fixed LP fee, and
  top-level `poolFeeBeneficiaries` are supported.

To use `RehypeDopplerHookMigrator`, add `migration.rehype` with:

- `buybackDestination`: a non-zero EVM address.
- `customFee`: the static Rehype hook fee, as an integer from `0` through
  `1000000`.
- `feeDistributionInfo`: the same eight-field WAD matrix described above;
  each four-field currency row must total `1000000000000000000`.
- Optional `feeRoutingMode`: `directBuyback` (the default) or
  `routeToBeneficiaryFees`.

The top-level migration `fee` remains the fixed Uniswap V4 LP fee.
`rehype.customFee` is a separate hook fee.
`routeToBeneficiaryFees` accrues hook fees for collection by
`buybackDestination`; it does not route them through top-level
`poolFeeBeneficiaries`.
