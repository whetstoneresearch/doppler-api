# Operations Runbook (Minimal P0)

## Scope

This runbook covers public-launch incidents for:

- create request failures
- nonce/transaction submission issues
- RPC/provider outages

## Quick checks

1. Confirm process health:
   - `GET /health`
   - `GET /ready`
2. Confirm service pressure:
   - `GET /metrics`
3. Find request in logs by `x-request-id`.

## Incident: create request failed before tx broadcast

Symptoms:

- `422`, `409`, `501`, or pricing errors from `POST /v1/launches`.

Actions:

1. Validate payload shape against `docs/openapi.yaml`.
2. If using idempotency:
   - reuse the same `Idempotency-Key` for safe retry with identical payload
   - do not reuse the key with changed payload
3. If pricing error:
   - provide explicit `pricing.numerairePriceUsd` or fix pricing provider config.

## Incident: tx broadcast/nonce issues

Symptoms:

- intermittent send failures, nonce-related errors, pending tx buildup.

Actions:

1. Check wallet account has funds for gas.
2. Verify chain RPC is healthy (`/ready`).
3. Retry request with same `Idempotency-Key`.
4. If persistent:
   - restart service once to clear transient RPC client state
   - verify no parallel systems are using the same `PRIVATE_KEY`.

## Incident: RPC degraded

Symptoms:

- `/ready` returns `503`, chain checks with `ok=false`.

Actions:

1. Switch `RPC_URL` or `CHAIN_CONFIG_JSON` RPC entries to healthy endpoints.
2. Restart service.
3. Re-run `/ready` and a small create test with idempotency key.

## Rollback

1. Redeploy previous known-good image/commit.
2. Keep idempotency store path stable so duplicate create requests are still protected.
3. Verify:
   - `/health` = 200
   - `/ready` = 200
   - `POST /v1/launches` succeeds with an idempotency key.
