# Contributing Guide

## Quality standards

This project uses:

- Oxlint for code quality
- Oxfmt for formatting
- Vitest for test coverage

## Local workflow

```bash
nvm use
npm install
npm run format
npm run lint:fix
npm test
```

## CI-oriented checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
```

Or run all checks in one command:

```bash
npm run check
```

## CI

- GitHub Actions runs `.github/workflows/ci.yml` on push/PR to `main`.
- The workflow installs dependencies with `npm ci` and runs `npm run check`.

## Container workflow

```bash
cp .env.example .env
docker compose up --build
```

## Conventions

- Keep API contracts backward-compatible where possible.
- Add tests with each behavior change:
  - unit tests for pure logic
  - integration tests for route/service wiring
  - live tests for onchain behavior
- Update docs in `docs/` whenever:
  - request/response fields change
  - environment config changes
  - capability matrix changes

## Contributor checklist

- [ ] Code compiles and tests pass locally
- [ ] Lint and format checks pass
- [ ] README and docs updated
- [ ] New behavior covered by tests
- [ ] `CHANGELOG.md` updated for user-visible behavior changes
