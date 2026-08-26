# 03 — Release regression suite and operations documentation

Status: ready-for-agent
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

## Comments
