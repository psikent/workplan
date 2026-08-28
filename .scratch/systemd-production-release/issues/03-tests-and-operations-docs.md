# 03 — Release regression suite and operations documentation

Status: resolved
Blocked by: 01, 02
Spec: ../spec.md
Scope: scripts/release.test.mjs, scripts/workplan.test.mjs, README.md

## Task

Finish the regression and operator-facing work described by R8–R9:

- Add scenario-level tests around systemd first install, normal update, preflight rejection, existing-unit replacement, successful verification, failed new release, successful rollback, and rollback failure reporting.
- Confirm macOS launchd, custom `--target --no-start`, and non-systemd manual manager behaviors have not regressed.
- Update production documentation with the explicit first-install command, normal sudo release command, `systemctl` lifecycle commands, `journalctl` diagnostics, file-log locations, and the non-root process guarantee.
- Clearly state that Linux production operators must not use `workplan.mjs start|stop|restart`, while preserving the manager documentation for supported non-systemd workflows.
- Document the local verification boundary and the separately authorized VPS checks: service state, PID user/group, loopback listener, ready health, and public Caddy HTTPS.

## Acceptance

- `corepack pnpm test`, `corepack pnpm typecheck`, `corepack pnpm build`, and `git diff --check` pass.
- Tests do not require root, systemd, a Linux host, or access to the VPS; privileged operations are represented through injected/fake command execution.
- README examples contain no secrets, host credentials, or instructions that could start the Linux production application as root.
- The implementation does not connect to or modify the production VPS.

## Answer

Implemented in `scripts/release.test.mjs` (50 tests total, all script tests green), `scripts/workplan.test.mjs`, and `README.md`:

- Scenario-level tests (injected/fake command execution, real filesystem in tmp dirs — no root, no systemd, no Linux host, no VPS): first install success (account created, unit rendered/verified/installed, enabled, started), normal update (unit kept, enable/account untouched, stop before promote), preflight rejection (missing unit, unsafe unit, incompatible account, `--no-start`) with proof of failure before build/stop/promotion/unit writes, existing-unit replacement with backup, successful verification, failed release with rollback, failed first install (service stopped + recovery notice), rollback-failure reporting, plus every per-stage injection and every R8 rejection mode.
- Regression confirmed: existing launchd command/state parser tests, custom `--target --no-start` CLI safeguard, manual manager lifecycle test, env helpers — all unchanged and passing. `manualManagerAllowed`/`systemdManagedUnitPath` guard tests added.
- README production docs rewritten: `sudo node scripts/release.mjs --install-systemd` first install, `sudo node scripts/release.mjs` normal release (with lifecycle order and acceptance criteria), `systemctl` lifecycle commands, `journalctl -u workplan`, file-log locations (`logs/workplan.log`, `logs/workplan.err.log`), the non-root `workplan:workplan` process guarantee, security boundaries (`0600` `.env`, root program files, service-owned data/logs/runtime), the explicit warning that Linux operators must not use `workplan.mjs start|stop|restart` (manager docs preserved for non-systemd workflows), and the local-verification boundary vs. separately authorized VPS checks (service state, PID user/group, loopback listener, ready health, public Caddy HTTPS). No secrets or host credentials appear in the README.

Verification: `corepack pnpm test` ✔, `corepack pnpm typecheck` ✔, `corepack pnpm build` ✔, `git diff --check` ✔. The implementation never connects to or modifies the production VPS.
