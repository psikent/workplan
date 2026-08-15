# 06 — Script: env-config:export command

Status: open
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
