---
name: deploy-production
description: Deploy or release the workplan app to production on hk3-jdi.dawu.us（发布生产、部署、上线、deploy、release、hk3）. SSH in, pull latest main, run the systemd release script, verify acceptance.
argument-hint: "Optional: branch or commit to deploy (defaults to origin/main)"
---

# Deploy workplan to production (hk3-jdi)

Deploy the workplan app to the Linux production host `hk3-jdi.dawu.us` as `root`: pull the latest code in the server source directory, then run the repo's release script and verify the acceptance checklist. This skill is the explicitly authorized path for VPS operations (the README notes release script itself never touches the VPS).

## 1. Connect (the SSH trap)

Git Bash's bundled `ssh` fails with `Permission denied (publickey)` — the authorized key lives in **1Password**, whose agent is exposed only as a Windows named pipe that only Windows OpenSSH can read. Always use:

```bash
SSH='/c/Windows/System32/OpenSSH/ssh.exe'
$SSH -o BatchMode=yes -o IdentityAgent="//./pipe/openssh-ssh-agent" -o StrictHostKeyChecking=accept-new root@hk3-jdi.dawu.us "COMMANDS"
```

- `BatchMode=yes` keeps it non-interactive; if it fails with publickey denied, the 1Password desktop app/agent is not running — stop and tell the user.
- 1Password may show an authorization prompt on the user's desktop per connection; batch remote work into few, larger `ssh` calls instead of many tiny ones.

## 2. Topology (verified 2026-08-31)

| What | Where / value |
| --- | --- |
| Source repo (git) | `/var/opt/workplan` (branch `main`, remote `https://github.com/psikent/workplan.git`) |
| Production dir | `/var/opt/workplan-release` (built files + prod deps, root-owned) |
| Previous-release backup | `/var/opt/workplan-release.previous-release` (one copy) |
| Service | systemd unit `workplan.service`, runs as `workplan:workplan` |
| Listener | `127.0.0.1:3000` only; public HTTPS via Caddy |
| Health endpoint | `http://127.0.0.1:3000/health/ready` |
| Logs | `journalctl -u workplan`, plus `workplan-release/logs/workplan.log` / `.err.log` |

`.env`, `data/`, `logs/` in the release dir are never overwritten by a release.

## 3. Preflight and pull

```bash
$SSH ... root@hk3-jdi.dawu.us "cd /var/opt/workplan && git status --porcelain && git fetch origin && git log --oneline HEAD..origin/main && git pull --ff-only origin main && git log -1 --oneline"
```

- Working tree must be clean; `pull --ff-only` must succeed. Abort and investigate on divergence.
- Read the incoming commit list aloud in the report — it is what is about to go live.
- Production runs the built app; confirm locally first that `origin/main` is green (typecheck/tests) before deploying.

## 4. Release

From the server source directory, as root (no `sudo` needed in a root session):

```bash
$SSH ... root@hk3-jdi.dawu.us "cd /var/opt/workplan && node scripts/release.mjs 2>&1 | tail -40"
```

The script's order is fixed: preflight → `corepack pnpm build` → stage → `systemctl stop` → promote files → install prod deps → config → ownership → start → acceptance. On any failure it automatically restores the previous release from `workplan-release.previous-release`, restarts, and re-verifies — report the original failure separately from any rollback.

## 5. Acceptance (must all pass)

The script prints the checklist; verify independently afterwards:

```bash
$SSH ... root@hk3-jdi.dawu.us "systemctl is-active workplan && curl -s http://127.0.0.1:3000/health/ready && ls -ld /var/opt/workplan-release/apps /var/opt/workplan-release.previous-release"
```

Expected: `active`; `{"status":"ready","database":"ok"}`; fresh mtimes on the promoted files and the previous-release backup. Full checklist per README: `systemd-analyze verify` pass, enabled + active, MainPID positive as `workplan:workplan`, single loopback listener only.

## 6. Rollback (only if the user asks or acceptance fails)

```bash
$SSH ... root@hk3-jdi.dawu.us "rsync -a --delete /var/opt/workplan-release.previous-release/apps/ /var/opt/workplan-release/apps/ && systemctl restart workplan && curl -s http://127.0.0.1:3000/health/ready"
```

(For a full-file rollback copy the other managed names too; `.env`, `data/`, `logs/` stay untouched.)

## Hard rules

- **Never** `node workplan.mjs start|stop|restart` on this host — it bypasses the unit and is rejected when `workplan.service` exists. Use `systemctl`.
- Installing or rewriting the unit requires the explicit `node scripts/release.mjs --install-systemd` (Linux + default target + root only); a routine release never touches host config.
- The app always runs as the non-root `workplan` account; root deploys and controls systemd only.
- Never commit the local `.ssh/` directory (gitignored); it is session-local.
