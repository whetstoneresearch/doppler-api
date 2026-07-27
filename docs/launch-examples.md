# Launch Request Examples and Defaults

The OpenAPI contract includes seven launch request examples:

- Static EVM: `CanonicalStaticCreateLaunchRequest`
- Multicurve EVM: `CanonicalMulticurveCreateLaunchRequest`
- Rehype EVM: `CanonicalRehypeCreateLaunchRequest`
- Dynamic EVM with Uniswap V2:
  `CanonicalUniswapV2DynamicCreateLaunchRequest`
- Dynamic EVM with Uniswap V4:
  `CanonicalUniswapV4DynamicCreateLaunchRequest`
- Dynamic EVM with Rehype Uniswap V4 migration:
  `CanonicalRehypeUniswapV4DynamicCreateLaunchRequest`
- Solana: `GenericSolanaCreateLaunchRequest`

Find these examples in [`openapi.yaml`](openapi.yaml) and use the matching one
as a starting point for a create request. Solana uses
`feeBeneficiaries` with `shareBps`; EVM pool-fee beneficiaries use
`poolFeeBeneficiaries` with `sharesWad`.

## Defaults

- EVM `chainId` may be omitted only when the deployment configures
  `DEFAULT_CHAIN_ID`; otherwise it is required.
- Omitted `tokensForSale` means the full supply is sold through the market.
- The non-market remainder can use up to 10 independent vesting schedules. A
  recipient may have more than one schedule.
- Omitted EVM governance and `false` resolve to `noOp`; `true` resolves to
  `default`; an EVM address resolves to `launchpad` with `multisig`.
- Omitted EVM `poolFeeBeneficiaries` resolves to the 95% user / 5% protocol
  owner default where pool-fee beneficiaries are supported.
- Rehype chooses either a `buybackDestination` or a 1 to 10 entry
  `rehypeFeeBeneficiaries` list totaling `1e18`. The list does not include the
  Airlock owner; its protocol fee is reserved separately.
- Dynamic `uniswapV4` uses a fixed LP fee. Optional `migration.rehype` selects
  RehypeDopplerHookMigrator with a separate static hook fee and distribution
  matrix.
