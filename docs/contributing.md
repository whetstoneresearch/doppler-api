# Contributing Guide

## Quality standards

This project uses:

- Oxlint for code quality (configured in `oxlint.config.ts` via `defineConfig`)
- Oxfmt for formatting (configured in `oxfmt.config.ts` via `defineConfig`)
- Vitest for test coverage
- Lefthook for git hooks (configured in `lefthook.yml`)

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

## Git hooks (lefthook)

Hooks install automatically via the `prepare` script when you run `npm install`. To install or refresh manually:

```bash
npx lefthook install
```

Configured hooks:

- `pre-commit` — runs `oxfmt` and `oxlint --fix --deny-warnings` against staged files (autofixes are restaged), then `tsc --noEmit` when TypeScript files are staged.
- `pre-push` — runs `format:check`, `lint`, `typecheck`, and `test:unit` in parallel.

To bypass the hook for a single commit, use `git commit --no-verify`. Prefer fixing issues over bypassing.

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
