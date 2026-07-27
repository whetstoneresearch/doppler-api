# Operations Runbook

Use this runbook for self-hosted deployments. Preserve the idempotency store
and pause create traffic before changing Redis, signer, or transaction state.

## Routine checks

```bash
curl --fail-with-body --silent --show-error \
  "${API_BASE_URL}/health"

curl --fail-with-body --silent --show-error \
  -H "x-api-key: ${API_KEY}" \
  "${API_BASE_URL}/ready"

curl --fail-with-body --silent --show-error \
  -H "x-api-key: ${API_KEY}" \
  "${API_BASE_URL}/metrics"
```

- `GET /health` reports process liveness and does not require authentication.
- `GET /ready` checks configured EVM RPCs and enabled Solana dependencies.
- `GET /metrics` exposes service metrics.
- Readiness does not check Redis after startup. Monitor Redis separately in
  shared deployments.

Correlate request failures with `x-request-id`. Do not include `API_KEY`,
`PRIVATE_KEY`, RPC credentials, or `REDIS_URL` in diagnostic output.

## Create request rejected

For `422` responses, validate the request against
[`openapi.yaml`](openapi.yaml) and inspect the returned error code.

When retrying:

- Reuse an `Idempotency-Key` only with the identical request.
- Use a new key for a genuinely new request.
- Shared deployments require an idempotency key for every create request.
- Correct pricing configuration or provide `pricing.numerairePriceUsd` when a
  pricing error prevents submission.

## Redis unavailable

Shared deployments use Redis for rate limiting, idempotency, and nonce locks.
All replicas must use the same Redis instance and `REDIS_KEY_PREFIX`.

1. Pause create traffic for every replica using the affected signer or Redis
   namespace.
2. Verify Redis connectivity, authentication, TLS, latency, memory, and
   persistence from the service network.
3. Confirm `DEPLOYMENT_MODE=shared`, `IDEMPOTENCY_ENABLED=true`, and
   `IDEMPOTENCY_BACKEND=redis`.
4. Do not flush Redis or delete idempotency and lock keys during recovery.
5. Restore Redis, restart replicas if connection settings changed, and
   reconcile in-doubt requests before resuming traffic.

## Idempotency store corruption

The file backend fails startup when its store cannot be parsed. The Redis
backend returns `IDEMPOTENCY_STORE_CORRUPT` when it reads an invalid record.

1. Pause create traffic and preserve the affected file or Redis record.
2. Restore a known-good backup only if it includes the affected request state.
3. Without a trustworthy backup, reconcile affected requests against chain
   history before changing a record.
4. Do not delete an uncertain record or wait for expiry to permit a retry;
   either action can allow a duplicate transaction.
5. Verify storage health, `/health`, and `/ready` before resuming traffic.

## Transaction status is uncertain

`IDEMPOTENCY_KEY_IN_DOUBT` means the API cannot prove that the original
transaction was rejected.

1. Stop retries and do not submit the request with a new idempotency key.
2. Use the error details and logs to reconcile the transaction:
   - EVM errors include `chainId`, `accountAddress`, and `nonce`.
   - Solana errors include `launchId`, `signature`, and `explorerUrl`.
3. Search a trusted RPC and explorer for pending, confirmed, replaced, reverted,
   or dropped transactions.
4. Resume only after establishing the transaction's outcome. Restarting,
   rolling back, or allowing locks and records to expire does not resolve an
   ambiguous submission.

`NONCE_LOCK_LOST` occurs before broadcast. Verify Redis health and replica
prefix consistency, then retry the identical request with the same
idempotency key.

## RPC degraded

`GET /ready` identifies an unhealthy configured chain but returns a sanitized
dependency error. Use service logs and read-only RPC calls to diagnose it.

1. Confirm the endpoint returns the expected chain ID and advancing block
   height.
2. Check authentication, rate limits, latency, TLS, and provider status.
3. Replace only the affected named RPC URL with an endpoint for the same chain.
4. Restart affected replicas and confirm `/ready` returns `200`.
5. Reconcile requests affected by the outage before resuming create traffic.

Do not use a create request as a health check because it can broadcast a
transaction.

## Rollback

1. Pause create traffic and record in-flight or in-doubt requests.
2. Confirm the target version can read the current idempotency data.
3. Preserve the signer, chain configuration, file store path or Redis
   namespace, and idempotency retention settings.
4. Do not clear or replace idempotency storage to force a healthy start.
5. Verify `/health`, `/ready`, `/v1/capabilities`, and `/metrics` with
   read-only requests.
6. Reconcile in-flight requests before gradually resuming traffic.
