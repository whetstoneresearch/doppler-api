# Operations Runbook (Minimal P0)

## Scope

This runbook covers public-launch incidents for:

- create request failures
- nonce/transaction submission issues
- RPC/provider outages

## Quick checks

1. Confirm process health:
   - `GET /health`
   - `GET /ready` (include `x-api-key`)
2. Confirm service pressure:
   - `GET /metrics` (include `x-api-key`)
3. Confirm shared-mode Redis config:
   - `DEPLOYMENT_MODE=shared`
   - `REDIS_URL` is set and reachable
   - all replicas share the same `REDIS_KEY_PREFIX`
4. Find request in logs by `x-request-id`.

## Incident: create request failed before tx broadcast

Symptoms:

- `422`, `409`, `501`, or pricing errors from `POST /v1/launches`.

Actions:

1. Validate payload shape against `docs/openapi.yaml`.
2. If using idempotency:
   - reuse the same `Idempotency-Key` for safe retry with identical payload
   - do not reuse the key with changed payload
   - in shared mode, create requests must include `Idempotency-Key`
3. If pricing error:
   - provide explicit `pricing.numerairePriceUsd` or fix pricing provider config.

## Incident: tx broadcast/nonce issues

Symptoms:

- intermittent send failures, nonce-related errors, pending tx buildup.
- `409 IDEMPOTENCY_KEY_IN_DOUBT` on create retries after crash/restart.

Actions:

1. Check wallet account has funds for gas.
2. Verify chain RPC is healthy (`/ready` with `x-api-key`).
3. Retry request with same `Idempotency-Key`.
4. If persistent:
   - restart service once to clear transient RPC client state
   - verify no parallel systems outside this deployment are using the same `PRIVATE_KEY`
   - confirm Redis connectivity and consistent `REDIS_KEY_PREFIX` across replicas so the nonce lock is shared.
5. If `IDEMPOTENCY_KEY_IN_DOUBT` is returned:
   - do not create with a new idempotency key until prior launch status is resolved
   - check logs for the original `x-request-id` and tx hash emission
   - if tx hash is known, poll `GET /v1/launches/:launchId` until confirmed/reverted

## Incident: RPC degraded

Symptoms:

- `/ready` returns `503`, chain checks with `ok=false`.
- readiness `checks[].error` is intentionally generic (`dependency unavailable`).

Actions:

1. Switch chain `rpcUrl` entries in `doppler.config.ts` (or override `RPC_URL` for `DEFAULT_CHAIN_ID`) to healthy endpoints.
2. Restart service.
3. Inspect server logs for the root-cause RPC error details.
4. Re-run `/ready` (with `x-api-key`) and a small create test with idempotency key.

## Rollback

1. Redeploy previous known-good image/commit.
2. Keep idempotency backend storage stable so duplicate create requests are still protected:
   - file backend: keep `IDEMPOTENCY_STORE_PATH` stable
   - redis backend: keep `REDIS_KEY_PREFIX` stable
3. Verify:
   - `/health` = 200
   - `/ready` (with `x-api-key`) = 200
   - `POST /v1/launches` succeeds with an idempotency key.
