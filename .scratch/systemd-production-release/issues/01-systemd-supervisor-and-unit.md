# 01 — Systemd supervisor detection and managed unit

Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: scripts/release.mjs, scripts/release.test.mjs

## Task

Add the Linux systemd supervisor path and the explicit `--install-systemd` interface described by R1–R5:

- Parse `--install-systemd` and reject unsupported platforms, custom targets, `--no-start`, and non-root execution before any release side effect.
- Detect and inspect `workplan.service` through systemd. A normal Linux formal release must reject a missing unit, root execution identity, or mismatched working directory, environment file, Node entry point, and target directory.
- Render the fixed `workplan:workplan` unit with absolute paths, file logging, restart policy, timeouts, private umask, loopback production configuration, and the agreed hardening baseline.
- In installation mode, create or validate the system group/account, validate the rendered unit, back up and atomically replace an existing unit, run `daemon-reload`, and enable the service.
- Route formal Linux stop/start/state operations exclusively through `systemctl`; retain the current launchd path and isolated manual behavior.
- Extract pure parsing, rendering, validation, and command-building helpers so behavior is testable on Windows without a live systemd manager.

## Acceptance

- Unit tests prove the generated unit uses `User=workplan`, `Group=workplan`, the formal target paths, direct Node execution, private file logs, restart/timeouts, and all required hardening fields.
- Tests prove every invalid invocation and unsafe existing unit fails before build, stop, promotion, account creation, or unit writes.
- Existing launchd command/state tests and custom-target safeguards continue to pass.
- No application process is started through `workplan.mjs` on a Linux formal release.

## Answer

Implemented in `scripts/release.mjs` (+ tests in `scripts/release.test.mjs`):

- `parseReleaseArgs` + `assertInstallSystemdPreconditions`: `--install-systemd` is rejected on non-Linux, custom `--target`, with `--no-start`, and as non-root — all before any build/stop/promotion/account/unit side effect. `--no-start` is also rejected on the Linux formal path (systemd releases must start and verify).
- `detectSupervisor` returns a systemd supervisor for Linux formal target; launchd/manual paths untouched and still pass their regression tests.
- Pure, exported, testable helpers: `renderSystemdUnit` (fixed `workplan:workplan`, absolute paths, direct Node exec of `apps/server/dist/index.js`, `append:` file logs, `Restart=on-failure`, bounded `RestartSec`/timeouts, `UMask=0077`, `NoNewPrivileges`/`PrivateTmp`/`ProtectSystem=strict`/`ProtectHome`, `ReadWritePaths` = data/logs/.runtime, `WantedBy=multi-user.target`), `parseSystemdUnit`, `validateSystemdUnit`, `systemdControlCommands`, `parseSystemctlShow`, `parsePsIdentity`, `parseLsofListenerDetails`/`groupListenersByPid`/`parseLsofPath`, `parseHealthReady`.
- Preflight (R4): Linux, root, `systemctl`/`systemd-analyze` present, active systemd manager; a normal release requires an existing unit validated against the fixed spec, else fails with a `--install-systemd` hint; unsafe units are never silently accepted.
- Lifecycle (R5): preflight → build → staging → `systemctl stop` → promote → `pnpm install --prod` → setup → ownership → (install: analyze-verify staged unit, backup, atomic replace, `daemon-reload`, enable) → `systemctl start` → verify. No process is ever started through `workplan.mjs`.
- Preflight unit/account failures and unsafe-unit errors are proven to happen before build/stop/promotion/account creation/unit writes in tests.
