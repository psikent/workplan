# 02 — Least-privilege ownership and complete rollback

Status: ready-for-agent
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

## Comments
