# Configuration

Self-hosted deployments use `doppler.config.ts` for typed, non-secret defaults
and environment variables for secrets and runtime overrides. Copy
`.env.example`, set the required values, and keep private keys and RPC URLs out
of the TypeScript configuration.

## Required environment variables

Every deployment requires:

- `API_KEY`: authenticates callers
- `PRIVATE_KEY`: EVM signer used to submit transactions
- At least one non-empty named EVM RPC variable from the table below

`API_KEYS` may contain additional comma-separated caller keys. `API_KEY` always
remains valid.

## EVM chains

Each non-empty variable enables its corresponding chain:

| Chain        | Chain ID | Environment variable   |
| ------------ | -------: | ---------------------- |
| Ethereum     |        1 | `ETHEREUM_RPC_URL`     |
| Monad        |      143 | `MONAD_RPC_URL`        |
| Robinhood    |     4663 | `ROBINHOOD_RPC_URL`    |
| Base         |     8453 | `BASE_RPC_URL`         |
| Base Sepolia |    84532 | `BASE_SEPOLIA_RPC_URL` |

Any non-empty subset is valid. The service rejects startup with `INVALID_ENV`
when none of these variables is configured.

`DEFAULT_CHAIN_ID` is optional. When set, it must identify a chain enabled by
its named RPC variable. It supplies the chain for EVM launch requests that omit
`chainId`. Without it, each EVM launch request must include `chainId`; omission
returns `CHAIN_ID_REQUIRED`. Requesting a supported chain whose named RPC is not
configured returns `CHAIN_NOT_CONFIGURED`.

There is no generic RPC variable and no Base Sepolia or first-enabled-chain
fallback.

## Server and deployment mode

Use `PORT`, `LOG_LEVEL`, `CORS_ORIGINS`, `RATE_LIMIT_MAX`,
`RATE_LIMIT_WINDOW_MS`, and `READY_RPC_TIMEOUT_MS` to configure the HTTP
service.

`DEPLOYMENT_MODE` supports:

- `standalone` (default): one process using local durable state. Idempotency may
  use the file or Redis backend, or be disabled.
- `shared`: multiple replicas. `REDIS_URL` is required,
  `IDEMPOTENCY_ENABLED` must be `true`, and `IDEMPOTENCY_BACKEND` must be
  `redis`. Create requests must include an idempotency key regardless of
  `IDEMPOTENCY_REQUIRE_KEY`.

`REDIS_KEY_PREFIX` namespaces Redis data. Selecting
`IDEMPOTENCY_BACKEND=redis` requires `REDIS_URL` in either deployment mode.

## Idempotency

`IDEMPOTENCY_ENABLED` enables durable create-request coordination.
`IDEMPOTENCY_BACKEND` is `file` or `redis`.

- The file backend persists records at `IDEMPOTENCY_STORE_PATH`.
- The Redis backend uses `REDIS_URL` and `REDIS_KEY_PREFIX`.
- `IDEMPOTENCY_REQUIRE_KEY` requires clients to send a key in standalone mode.
  Shared mode always requires one.
- `IDEMPOTENCY_TTL_MS` controls record retention.
- `IDEMPOTENCY_REDIS_LOCK_TTL_MS` and
  `IDEMPOTENCY_REDIS_LOCK_REFRESH_MS` control Redis locks. The refresh interval
  must be shorter than the lock TTL.

## Numeraire and pricing

`DEFAULT_NUMERAIRE_ADDRESS` overrides the default numeraire only for
`DEFAULT_CHAIN_ID`, so it requires `DEFAULT_CHAIN_ID`. It does not enable a
chain. For each launch, the service uses `pairing.numeraireAddress` from the
request when present, then the configured default for that chain, then the
Doppler SDK WETH address.

`PRICE_ENABLED` and the other `PRICE_*` variables configure optional EVM
numeraire pricing. The supported `PRICE_PROVIDER` values are `coingecko` and
`none`; provider URL, timeout, cache TTL, API key, and CoinGecko asset ID use
their corresponding `PRICE_*` variables.

## Solana

Solana configuration is separate from EVM configuration. Set
`SOLANA_ENABLED=true` and provide `SOLANA_KEYPAIR` to enable it. The devnet
RPC and WebSocket variables have public defaults and may be overridden.
`SOLANA_CONFIRM_TIMEOUT_MS`, `SOLANA_DEVNET_ALT_ADDRESS`, and
`SOLANA_PRICE_*` configure the remaining behavior. Solana Mainnet Beta
execution is not supported.

Solana settings do not enable an EVM chain or satisfy the requirement for a
named EVM RPC variable. They also do not change the Solana request contract,
which uses `feeBeneficiaries`.
