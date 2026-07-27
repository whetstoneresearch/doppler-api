# Contributing

## Setup

Requirements: Node.js 22 and npm 10.

```bash
nvm use
npm ci
cp .env.example .env
```

Configure `.env`, then start the development server:

```bash
npm run dev
```

## Checks

Apply formatting and lint fixes:

```bash
npm run fix
```

Run all CI checks:

```bash
npm run check
```

`npm run check` runs formatting, lint, type-checking, and tests.

## Git hooks

The `prepare` script installs Lefthook during dependency installation. To
install or refresh hooks manually:

```bash
npx lefthook install
```

Configured hooks:

- `pre-commit`: formats and lints staged files, restages fixes, and runs the
  project type-check when TypeScript files are staged.
- `pre-push`: runs `format:check`, `lint`, `typecheck`, and `test:unit` in
  parallel.

## CI

GitHub Actions runs `.github/workflows/ci.yml` for pushes and pull requests to
`main`. It installs dependencies with `npm ci` and runs `npm run check`.

## Container workflow

```bash
cp .env.example .env
docker compose up --build
```

## Conventions

- Keep API contracts backward-compatible where possible.
- Add unit tests for pure logic, integration tests for route or service wiring,
  and live tests for onchain behavior.
- Update `README.md`, `AGENT_INTEGRATION.md`, and relevant files under `docs/`
  when behavior or API contracts change.

## Contributor checklist

- [ ] `npm run check` passes.
- [ ] New behavior is covered by the appropriate tests.
- [ ] README, integration guidance, and relevant docs are updated.
- [ ] `CHANGELOG.md` is updated for user-visible behavior changes.
