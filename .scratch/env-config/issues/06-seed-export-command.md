# 06 — Script: env-config:export command

Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: scripts/env-config-export (new), package.json (root), script test

## Task

Add a root script `env-config:export` that:

- Opens the development database exactly as the dev server does (reuse the server's config/db modules through tsx — one source of truth, no duplicated schema),
- Builds the package with `EnvConfigService.exportPackage()`,
- Writes pretty-printed JSON to `data/env-config.seed.json`.

Structure the script as "compute package" + "write file" so the compute part is testable in isolation.

## Acceptance

- Running `corepack pnpm env-config:export` in a dev checkout produces a file that validates as schemaVersion 2 and round-trips through `/env-config/validate`.
- A `node --test` case (under `scripts/`, wired into the existing root test script) covers the compute part against a temp DB.

## Comments

- Implemented `scripts/env-config-export.ts` as a thin CLI adapter: it opens the configured development database through `openDatabase`, wires the same minimum service graph as the server, calls `EnvConfigService.exportPackage()`, and always closes SQLite.
- Split the public `computeEnvConfigPackage` and `writeEnvConfigSeed` seams. The writer emits pretty-printed JSON with a trailing newline to `<config.dataDir>/env-config.seed.json`, so the default path is `data/env-config.seed.json` and `DATA_DIR` overrides stay aligned with server startup restore.
- Added the root `env-config:export` command. It builds `@workplan/contracts` first for fresh checkouts, then runs the TypeScript CLI through the server workspace's `tsx` dependency.
- Added `scripts/env-config-export.test.mjs`, wired into the root test command through Node's test runner plus the `tsx` loader. The test uses a temporary migrated database and verifies all three package sections through the shared schema parser.
- Verification: target script test 1/1; server 59/59; web 77/77; runtime scripts 3/3; root test 1/1 for the new script; workspace typecheck green; contracts/server build green; standalone script TypeScript check green. An isolated `DATA_DIR` run produced pretty-printed schemaVersion 2 JSON, and the existing EnvConfigService suite verifies export → validate/import round-trip. Independent Standards + Spec review: 0 findings.
