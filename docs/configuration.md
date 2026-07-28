# Configuration

The service uses `doppler.config.ts` for typed, non-secret defaults and environment variables for secrets and runtime overrides. Copy `.env.example`, set the required values, and keep private keys and RPC URLs out of the TypeScript configuration.

Unless a row says otherwise, a blank value uses the documented default. Boolean runtime settings accept `1`, `true`, `yes`, `y`, or `on` and `0`, `false`, `no`, `n`, or `off`, case-insensitively. Unrecognized Boolean values fall back to the documented default.

## Required

Every service instance requires:

| Variable | Default | Constraint |
| --- | --- | --- |
| `API_KEY` | None | Non-empty caller credential. It remains valid when `API_KEYS` adds more credentials. |
| `PRIVATE_KEY` | None | EVM signer private key used to submit transactions. |
| One named EVM RPC variable | None | At least one non-empty RPC variable from the named-chain table below must be set. |

The service rejects startup with `MISSING_ENV` when either required credential is absent and with `INVALID_ENV` when no named EVM RPC is configured.

## Optional core

| Variable | Default | Constraint |
| --- | --- | --- |
| `API_KEYS` | Empty | Comma-separated additional caller credentials. Empty entries are removed and duplicate keys are deduplicated. |
| `PORT` | `3000` | Positive number; invalid or non-positive values fall back to the default. |
| `LOG_LEVEL` | `info` | Non-empty logger level. |
| `CORS_ORIGINS` | Empty list | Comma-separated origins. |
| `RATE_LIMIT_MAX` | `100` | Positive request count; invalid or non-positive values fall back to the default. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Positive window in milliseconds; invalid or non-positive values fall back to the default. |
| `READY_RPC_TIMEOUT_MS` | `2000` | Positive RPC readiness timeout in milliseconds; invalid or non-positive values fall back to the default. |
| `DEPLOYMENT_MODE` | `standalone` | `standalone` or `shared`. When it is unset and `NODE_ENV=production`, the effective mode is `shared`. |
| `NODE_ENV` | Unset | `production` selects shared mode only when `DEPLOYMENT_MODE` is unset. |

`standalone` mode supports the file or Redis idempotency backend and may disable idempotency. `shared` mode requires `REDIS_URL`, `IDEMPOTENCY_ENABLED=true`, and `IDEMPOTENCY_BACKEND=redis`. It also requires an idempotency key on every create request regardless of `IDEMPOTENCY_REQUIRE_KEY`.

## Named EVM chain RPCs

Each non-empty RPC variable enables exactly one chain:

| Chain        | Chain ID | Variable               | Default |
| ------------ | -------: | ---------------------- | ------- |
| Ethereum     |        1 | `ETHEREUM_RPC_URL`     | None    |
| Monad        |      143 | `MONAD_RPC_URL`        | None    |
| Robinhood    |     4663 | `ROBINHOOD_RPC_URL`    | None    |
| Base         |     8453 | `BASE_RPC_URL`         | None    |
| Base Sepolia |    84532 | `BASE_SEPOLIA_RPC_URL` | None    |

Any non-empty subset is valid. There is no generic RPC variable and no Base Sepolia or first-enabled-chain fallback.

| Variable | Default | Constraint |
| --- | --- | --- |
| `DEFAULT_CHAIN_ID` | None | Positive integer identifying a chain enabled by its named RPC. Requests to the shared EVM launch route may omit `chainId` only when this is set. |
| `DEFAULT_NUMERAIRE_ADDRESS` | Chain configuration, then the Doppler SDK WETH address | Requires `DEFAULT_CHAIN_ID` and overrides the default numeraire only for that chain. A request's `pairing.numeraireAddress` takes precedence. |

Without `DEFAULT_CHAIN_ID`, each EVM launch request must include `chainId`; omission returns `CHAIN_ID_REQUIRED`. A supported chain without its named RPC returns `CHAIN_NOT_CONFIGURED`.

## Idempotency

| Variable | Default | Constraint |
| --- | --- | --- |
| `IDEMPOTENCY_ENABLED` | `true` | Must be `true` in shared mode. |
| `IDEMPOTENCY_BACKEND` | `file` | `file` or `redis`; shared mode requires `redis`. |
| `IDEMPOTENCY_REQUIRE_KEY` | `false` | Requires callers to send an idempotency key in standalone mode. Shared mode always behaves as `true`. |
| `IDEMPOTENCY_TTL_MS` | `86400000` | Positive record-retention duration in milliseconds; invalid or non-positive values fall back to the default. |
| `IDEMPOTENCY_STORE_PATH` | `.data/idempotency-store.json` | Non-empty path used by the file backend. |
| `IDEMPOTENCY_REDIS_LOCK_TTL_MS` | `900000` | Positive Redis lock TTL in milliseconds; invalid or non-positive values fall back to the default. |
| `IDEMPOTENCY_REDIS_LOCK_REFRESH_MS` | `300000` | Positive refresh interval in milliseconds and strictly less than `IDEMPOTENCY_REDIS_LOCK_TTL_MS`. |

## Pricing

These settings control optional automatic EVM numeraire pricing:

| Variable | Default | Constraint |
| --- | --- | --- |
| `PRICE_ENABLED` | `true` | When false, automatic provider resolution is unavailable; request-level pricing may still be supplied. |
| `PRICE_PROVIDER` | `coingecko` | `coingecko` or `none`. `none` disables provider resolution. |
| `PRICE_BASE_URL` | `https://api.coingecko.com/api/v3` | Non-empty provider base URL. |
| `PRICE_TIMEOUT_MS` | `3000` | Positive provider timeout in milliseconds; invalid or non-positive values fall back to the default. |
| `PRICE_CACHE_TTL_MS` | `15000` | Positive in-memory cache TTL in milliseconds; invalid or non-positive values fall back to the default. |
| `PRICE_API_KEY` | None | Optional provider API key. |
| `PRICE_COINGECKO_ASSET_ID` | `ethereum` | Non-empty CoinGecko asset ID used for the configured default EVM numeraire. |

## Redis

| Variable | Default | Constraint |
| --- | --- | --- |
| `REDIS_URL` | None | Required in shared mode and whenever `IDEMPOTENCY_BACKEND=redis`. Shared mode also uses Redis for rate limiting and signer nonce locks. |
| `REDIS_KEY_PREFIX` | `doppler-api` | Non-empty namespace shared by replicas that coordinate with one another. |

## Solana

Solana configuration is independent of EVM configuration and does not satisfy the named EVM RPC requirement.

| Variable | Default | Constraint |
| --- | --- | --- |
| `SOLANA_ENABLED` | `false` | Enables Solana launch handling. |
| `SOLANA_DEFAULT_NETWORK` | `solanaDevnet` | `solanaDevnet` or `solanaMainnetBeta`; only devnet execution is currently supported. |
| `SOLANA_DEVNET_RPC_URL` | `https://api.devnet.solana.com` | Must be explicitly non-empty when Solana is enabled. |
| `SOLANA_DEVNET_WS_URL` | `wss://api.devnet.solana.com` | Must be explicitly non-empty when Solana is enabled. |
| `SOLANA_MAINNET_BETA_RPC_URL` | None | Reserved for Mainnet Beta; Mainnet Beta execution is not supported. |
| `SOLANA_MAINNET_BETA_WS_URL` | None | Reserved for Mainnet Beta; Mainnet Beta execution is not supported. |
| `SOLANA_KEYPAIR_PATH` | None | Preferred payer input: path to a Solana CLI keypair file. Mutually exclusive with `SOLANA_KEYPAIR`. |
| `SOLANA_KEYPAIR` | None | Inline payer fallback: JSON array of exactly 64 integer secret-key bytes, each from 0 through 255. Mutually exclusive with `SOLANA_KEYPAIR_PATH`; one payer input is required when Solana is enabled. |
| `SOLANA_CONFIRM_TIMEOUT_MS` | `60000` | Positive integer confirmation timeout in milliseconds; invalid values fail startup. |
| `SOLANA_DEVNET_ALT_ADDRESS` | None | Optional devnet address lookup table reused when the transaction fits. Oversized transactions fall back to a launch-specific lookup table. |
| `SOLANA_PRICE_MODE` | `required` | `required`, `fixed`, or `coingecko`. `required` expects request pricing; `fixed` uses the configured fixed price; `coingecko` resolves the configured asset. |
| `SOLANA_FIXED_NUMERAIRE_PRICE_USD` | None | Positive number. Required when Solana is enabled with `SOLANA_PRICE_MODE=fixed`. |
| `SOLANA_COINGECKO_ASSET_ID` | `solana` | Non-empty CoinGecko asset ID used in `coingecko` mode. |

Solana request fee routing uses `feeBeneficiaries`. It does not change the EVM fee-routing contract.

Solana RPC requests retry HTTP `429` responses up to five total attempts with bounded exponential backoff. A signed launch that remains larger than the Solana packet limit after launch-specific lookup-table compression returns `422 SOLANA_TRANSACTION_TOO_LARGE`.

## Live tests

These variables configure the onchain live suite and are not service runtime settings:

| Variable | Default | Constraint |
| --- | --- | --- |
| `LIVE_TEST_ENABLE` | `false` | The literal string `true` enables live scenarios. `npm run test:live` and `npm run test:all` set it for the live suite. |
| `LIVE_TEST_VERBOSE` | `false` | The literal string `true` enables verbose live output. |
| `LIVE_TEST_FILTER` | `all` | `all`, `static`, `dynamic`, `uniswap-v2`, `uniswap-v4`, `multicurve`, `multicurve-defaults`, `fees`, `governance`, `negative`, `solana`, or a documented `solana-*` script filter. `all` runs EVM scenarios, not Solana scenarios. |
| `LIVE_NUMERAIRE_PRICE_USD` | `3000` | Numeric USD fixture used by EVM live launch inputs. |
| `LIVE_TEST_MIN_BALANCE_ETH` | Derived estimate | Optional non-negative ETH balance override. When set, it replaces the transaction-count estimate. |
| `LIVE_TEST_ESTIMATED_TX_COST_ETH` | `0.000133333333333333` | Non-negative ETH amount used per estimated EVM launch when no minimum-balance override is set. |
| `LIVE_TEST_ESTIMATED_OVERHEAD_ETH` | `0.000133333333333333` | Non-negative ETH overhead added when no minimum-balance override is set. |
| `LIVE_TEST_MIN_BALANCE_SOL` | Derived estimate | Optional non-negative SOL balance override with at most nine decimal places. When set, it replaces the transaction-count estimate. |
| `LIVE_TEST_ESTIMATED_TX_COST_SOL` | `0.025` | Non-negative SOL amount with at most nine decimal places, used per estimated Solana launch when no minimum-balance override is set. |
| `LIVE_TEST_ESTIMATED_OVERHEAD_SOL` | `0.01` | Non-negative SOL amount with at most nine decimal places, added when no minimum-balance override is set. |

EVM live filters require `DEFAULT_CHAIN_ID` and its named RPC plus the signer configuration. Solana live filters require `SOLANA_ENABLED=true`, a funded `SOLANA_KEYPAIR_PATH` or `SOLANA_KEYPAIR`, and devnet endpoints. They also require `SOLANA_DEVNET_ALT_ADDRESS`, except for `solana-failing`. Successful Solana live scenarios retry transient `SOLANA_NOT_READY` and `SOLANA_SUBMISSION_FAILED` create responses once after 10 seconds.
