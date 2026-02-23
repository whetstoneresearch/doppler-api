# Documentation

This folder contains the complete API and operations reference for the Doppler Launch API.

## Contents

- `docs/openapi.yaml`
  - OpenAPI 3.1 specification for all implemented endpoints.
  - Best entry point for code generation and AI-assisted integrations.
- `docs/api-reference.md`
  - Human-readable endpoint reference with request/response behavior.
- `docs/custom-curves.md`
  - Detailed guide for multicurve preset and ranges payloads.
- `docs/mvp-launch.md`
  - Minimal launch example plus defaults-resolution reference.
- `docs/configuration.md`
  - Environment variables, defaults, and multichain configuration.
- `docs/errors.md`
  - Error model and common error codes.
- `docs/contributing.md`
  - Linting/formatting conventions and contributor workflow.
- `docs/runbook.md`
  - Minimal operational procedures for public launch incidents.

Project-level reference files:

- `CHANGELOG.md`
  - Release history and known MVP limitations.
- `SECURITY.md`
  - Vulnerability disclosure and supported version policy.
- `LICENSE`
  - Repository license terms.
- `.github/workflows/ci.yml`
  - CI workflow that runs `npm run check`.

## Source of truth

- Route and schema behavior is implemented in:
  - `src/app/routes/*`
  - `src/modules/launches/schema.ts`
  - `src/modules/auctions/multicurve/schema.ts`
  - `src/modules/*/service.ts`

When behavior changes in code, update these docs in the same PR.
