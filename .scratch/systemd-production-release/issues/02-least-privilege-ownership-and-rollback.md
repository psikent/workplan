# 02 — Least-privilege ownership and complete rollback

Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: scripts/release.mjs, scripts/runtime-core.mjs, scripts/workplan.mjs, script tests

## Task

Complete the Linux release transaction and filesystem boundary described by R5–R8:

- Add a systemd-only setup path that forces `HOST=127.0.0.1` while preserving every unrelated `.env` entry and valid `APP_SECRET`.
- Normalize formal release ownership after promotion: root-controlled code and dependencies, root-only `.env`, and private `workplan:workplan` ownership for data, logs, runtime state, and pre-created log files.
- Relocate the previous program backup from service-writable `.runtime` to a root-managed sibling path while preserving the one-version rollback contract.
- Include dependency installation, setup, permissions, optional unit replacement, start, and acceptance verification in one recoverable transaction.
- On failure, restore the previous files, permissions, and unit; reload systemd; restart and verify the previous version. Handle first-install failure explicitly when no prior release or unit exists.
- Verify enabled/active state, MainPID identity and paths, single loopback listener, and the structured ready response. Keep public HTTPS outside the rollback gate.
- Preserve the first failure as the command failure and report rollback errors separately without printing `.env` or sensitive log content.

## Acceptance

- Tests prove systemd setup replaces only `HOST`, preserves existing secrets and unrelated configuration, and leaves `.env` private.
- Tests prove the service account cannot write program or rollback files but can write required data/log/runtime paths.
- Failure injection at promotion, install, setup, permission, unit, start, process-identity, listener, and health stages restores all recoverable prior state.
- Verification rejects root/wrong-user PIDs, wrong executable or cwd, multiple listeners, wildcard binds, wrong ports, unhealthy HTTP responses, and incomplete ready payloads.
- Existing manual-manager and runtime configuration tests remain green.

## Answer

Implemented across `scripts/release.mjs`, `scripts/runtime-core.mjs`, `scripts/workplan.mjs`:

- `normalizeSystemdEnv` (runtime-core) + `setupSystemdRelease`: systemd-only setup forces `HOST=127.0.0.1` (and the formal `PORT=3000`), preserves every unrelated `.env` entry and any valid `APP_SECRET`, writes `.env` as root-private `0600`, and pre-creates private log files.
- `buildSystemdOwnershipPlan` + `applyOwnershipPlan`: program files, dependencies and `${target}.previous-release` stay root-owned (`u=rwX,go=rX`); `.env` is root `0600`; `data/`, `logs/`, `.runtime/` become `workplan:workplan` (`u=rwX,go=`); backups of `.env` stay root `0600`.
- Previous program backup relocated from service-writable `.runtime` to the root-managed sibling `${targetRoot}.previous-release` (`previousReleaseRoot`/`promoteStaging`/`restorePreviousRelease`; legacy launchd path uses the same location).
- Transactional lifecycle with injected-command IO (`runSystemdRelease` + `hooks.beforeStep`): dependency install, setup, ownership, unit replacement, start and full R8 verification are one recoverable transaction. On failure: stop, restore program files/.env/unit (or remove the just-installed unit when none existed), `daemon-reload`, re-apply ownership, start and verify the previous version; the original error is preserved and `error.rollbackErrors` reports rollback problems separately (never printing `.env` or log contents). First-install failure leaves the service stopped with `error.recoveryNotice`.
- Account handling: idempotent `groupadd --system` / `useradd --system --no-create-home --user-group --shell <nologin>`; preflight rejects existing-but-incompatible identities (UID 0, missing group, non-member) before any change; post-creation state is validated.
- `workplan.mjs` refuses `start|stop|restart` on Linux hosts where `workplan.service` exists (`manualManagerAllowed`), keeping manual management for non-systemd workflows; its regression tests still pass.

Tests prove: setup replaces only HOST and preserves secrets/unrelated entries with private `.env`; ownership plan keeps program/rollback paths root and runtime paths service-owned; failure injection at promote/install/setup/ownership/unit/start/verify and verify-stage identity failures restore all recoverable state; first-install failure removes the unit and stops; rollback failures are reported separately; verification rejects root/wrong-user PIDs, wrong executable/cwd, multiple listeners, wildcard binds, wrong ports, unhealthy HTTP and incomplete ready payloads.
