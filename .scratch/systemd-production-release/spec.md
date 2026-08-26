# Spec: Systemd Production Release

## Goal

Make the Linux production release path use systemd as the only process supervisor while keeping deployment privileges separate from application privileges. A release may be performed with root privileges, but the Workplan Node process must run as the dedicated non-root `workplan:workplan` account and must never silently fall back to a root-owned detached process.

## Background facts

- `scripts/release.mjs` currently recognizes a matching macOS launchd service. On Linux it otherwise falls back to the detached-process manager in `workplan.mjs`.
- The default release target is the `workplan-release` directory beside the source checkout; custom sibling targets require `--no-start`.
- The verified Linux production topology uses `/etc/systemd/system/workplan.service`, `/var/opt/workplan-release`, `/usr/bin/node`, `workplan:workplan`, `127.0.0.1:3000`, and Caddy as the public HTTPS entry point.
- The release preserves `.env`, `data/`, `logs/`, and one previous program version. Production data and logs must remain writable by the service account, while program files must not be writable by it.
- macOS launchd remains supported. This effort does not replace non-Linux lifecycle behavior.

## Requirements

### R1 Command-line and platform behavior

- `node scripts/release.mjs` remains the normal release command.
- Add `--install-systemd` for explicit first-time installation or deliberate replacement of the managed Linux unit.
- `--install-systemd` is valid only on Linux, for the default formal release target, and when the release script is running as root. Invalid combinations fail before build, stop, promotion, or system configuration changes.
- A normal Linux formal release requires an existing valid `workplan.service`. If the unit is absent or unsafe, fail with a message directing the operator to rerun with `--install-systemd`; never fall back to `workplan.mjs start`.
- Existing macOS launchd behavior remains intact. A custom `--target` continues to require `--no-start` and must not install or control systemd.

### R2 Dedicated service identity

- The service name is fixed as `workplan.service`; the application user and group are fixed as `workplan:workplan`. No command-line override is added.
- During `--install-systemd`, create the group and system account idempotently when absent. The account has no interactive login shell and no home directory.
- If an existing user or group is incompatible, or the resolved service user has UID 0, abort without changing the service.
- Root/sudo controls release files and systemd. The Node application process itself must always run as `workplan:workplan`.

### R3 Managed systemd unit

- Install the unit at `/etc/systemd/system/workplan.service` with absolute paths for `WorkingDirectory`, `EnvironmentFile`, the Node executable, the server entry point, and log files.
- The unit directly supervises `apps/server/dist/index.js`; it must not invoke the detached-process manager.
- Configure `Type=simple`, `User=workplan`, `Group=workplan`, `Restart=on-failure`, a bounded restart delay, bounded start/stop timeouts, `UMask=0077`, and `WantedBy=multi-user.target`.
- Enable a stable hardening baseline: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, and `ProtectHome`. Only the required runtime data and log paths may be writable.
- Preserve file logs at `logs/workplan.log` and `logs/workplan.err.log`. The journal remains available for systemd lifecycle and failure diagnostics; it is not required to duplicate every application log line.
- Systemd mode forces the effective production `HOST` to `127.0.0.1` while preserving all unrelated `.env` values and valid secrets. `PORT` remains `3000` for the formal service.

### R4 Preflight and existing-unit validation

- Before building or stopping anything, verify Linux, root privileges, the `systemctl` and `systemd-analyze` commands, and an active systemd system manager.
- For a normal release, inspect the effective unit and require the fixed service user/group, expected working directory, environment file, absolute Node/server entry point, and non-root execution.
- For `--install-systemd`, render and validate the proposed unit before replacing the live unit. Back up an existing unit before an atomic replacement, then run `systemctl daemon-reload`.
- An unsafe or unrelated unit is never silently accepted by a normal release.

### R5 Release lifecycle

- Execute the Linux formal release in this order: preflight, build, prepare staging, stop the unit, promote managed files, install production dependencies, initialize production configuration, apply ownership and permissions, install/update the unit when explicitly requested, enable the unit when installed, start the unit, and verify readiness.
- Use `systemctl stop` and `systemctl start` for Linux formal releases. Do not send signals through the manual PID manager.
- Preserve the current stop-before-promotion single-process rule so SQLite and the embedded schedulers are never served concurrently by old and new versions.

### R6 Ownership and writable paths

- Program files, production dependencies, and rollback program files are root-owned and not writable by the service user.
- `.env` is root-owned with mode `0600`; systemd reads it before launching the unprivileged process. Secret values must never be printed.
- `data/`, `logs/`, and the Linux runtime directory are owned by `workplan:workplan`, with no access granted beyond what the service requires. Pre-create log files with private permissions.
- Move the previous-release program backup out of the service-writable `.runtime` tree to a root-managed sibling path such as `${targetRoot}.previous-release`. Keep one recoverable previous version.

### R7 Full rollback

- Treat dependency installation, setup, permission normalization, unit installation, systemd startup, and every acceptance check as part of the release transaction.
- If failure occurs after promotion, stop the failed service, restore the previous program files and permissions, restore the previous unit when one was replaced (or remove the newly installed unit when none existed), run `daemon-reload`, start the previous version, and verify it.
- Keep the original failure as the release failure. Report rollback failures separately without exposing environment or log secrets.
- A failed first installation with no previous release leaves the service stopped and reports the exact manual recovery state.

### R8 Success verification

- A Linux formal release succeeds only when all of these checks pass:
  - `systemd-analyze verify` accepts the installed unit;
  - `systemctl is-enabled workplan` and `systemctl is-active workplan` succeed;
  - `systemctl show` reports one positive `MainPID`;
  - the MainPID resolves to `workplan:workplan`, the expected Node executable, and the formal release working directory;
  - exactly one formal process listens on `127.0.0.1:3000`, with no wildcard/public bind;
  - `http://127.0.0.1:3000/health/ready` succeeds and reports `status=ready` and `database=ok`.
- Public HTTPS through Caddy is an operational follow-up, not an automatic rollback gate in this script.

### R9 Documentation and compatibility

- Document first installation with `sudo node scripts/release.mjs --install-systemd`, subsequent releases with `sudo node scripts/release.mjs`, and operations with `systemctl`, `journalctl`, and the existing log files.
- Do not instruct Linux production operators to call `node workplan.mjs start|stop|restart` because that bypasses the unit and its service identity.
- Keep manual manager documentation for platforms and isolated workflows where systemd is not the formal supervisor.

## Acceptance

- Pure unit rendering and parsing helpers are covered without requiring a live systemd host.
- Tests cover missing/unsafe units, illegal flag combinations, account validation, ownership plans, service lifecycle commands, complete rollback, and every success criterion.
- Existing launchd, manual manager, custom-target, build, typecheck, and release tests remain green.
- `corepack pnpm test`, `corepack pnpm typecheck`, `corepack pnpm build`, and `git diff --check` pass before delivery.
- Repository implementation and local verification do not connect to or modify the production VPS. VPS rollout requires separate explicit authorization.

## Out of scope

- Connecting to, changing, or releasing the current VPS.
- Modifying Caddy, DNS, TLS, firewall, time synchronization, or public routing.
- Supporting alternative Linux supervisors, service names, users, groups, ports, or formal target layouts.
- Passwordless sudo policy or a non-root deploy-account workflow.
- Replacing launchd or removing the manual process manager from non-systemd workflows.
