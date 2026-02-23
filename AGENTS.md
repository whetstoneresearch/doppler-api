# Agent Rules For This Repo

## Scope and dependencies

- Keep changes as small and focused as possible.
- Prefer editing existing modules over introducing new abstractions.
- Introduce as few dependencies as possible, ideally none.

## Required updates per code change

When behavior or API contracts change, update all of:

- `README.md`
- `AGENT_INTEGRATION.md`
- relevant files under `docs/`
- tests (`tests/unit` and/or `tests/integration`; `tests/live` when onchain behavior changes)

## Live test regression guardrails

- Treat `LOW Default Configuration`, `MEDIUM Default Configuration`, and `HIGH Default Configuration`
  as baseline scenarios that must not regress when adding new launch modes/assertions.
- New assertions in shared live helpers must be scenario-scoped:
  only assert allocation/vesting details when non-market allocation is actually configured.
- When decoding calldata, match the exact SDK encoding shape.
  Do not wrap flat ABI parameter lists inside an extra `tuple` unless the SDK encodes a tuple.

## Verification before finishing

Run:

```bash
npm run lint
npm run typecheck
npm test
```

If any check cannot run, explicitly state why.
