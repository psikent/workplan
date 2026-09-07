## 核心工作流程（强制）

1. **新增需求前，先同步最新远端代码**：`git fetch origin` 并比对本地 `main` 与 `origin/main`，避免同一问题在其他机器上已被修改而重复改动。详见下方 Pre-dev sync check。
2. **代码修改完成后，先经 `code-reviewer` 子智能体审核，无问题后再部署到生产环境**：派 `code-reviewer` 审核脏 diff 并修复 P0/P1 发现，确认无问题后再提交；生产部署由 auto-release hook 在 typecheck + test 全绿后自动执行。详见下方 Code review gate 与 Auto-release hook。

## Pre-dev sync check

The user develops from multiple machines. At the start of every development session, before any work, verify the local tree is current: `git fetch origin`, then compare local `main` against `origin/main` (e.g. `git rev-list --left-right --count main...origin/main`) and note uncommitted changes. If local is behind `origin/main`, confirm with the user first, then update (mind any uncommitted changes; prefer `--ff-only`). Never start development on a stale tree — another machine may have already fixed or changed what you are about to touch.

## Agent skills

### New feature requests

When the user proposes a new feature or requirement, run the `grill-with-docs` skill: grill the idea with the `grilling` protocol and `domain-modeling` docs, then present the requirements plan (spec + tickets) for approval before developing.

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses the single-context layout. See `docs/agents/domain.md`.

### Auto-release hook

Workspace-scoped triggers — the ZCode `Stop` hook (gitignored `.zcode/config.json`) and the pi extension (gitignored `.pi/extensions/auto-release.ts`) — both run `.zcode/hooks/auto-release.sh` after every agent turn; a shared lockfile makes double triggers safe. It acts only when the working tree is dirty, local `main` is ahead of `origin/main`, or the production marker (`.zcode/hooks/deployed.sha`) is behind HEAD. It runs `pnpm run typecheck` + `pnpm test`; when green it commits (falling back to `--no-gpg-sign` if 1Password signing fails), rebases and pushes to `origin/main`, then releases to hk3 following the `deploy-production` skill (preflight → `release.mjs` → health acceptance) and records the deployed SHA. All output goes to `.zcode/hooks/auto-release.log`; the hook never blocks the session. Because of this, there is no need to commit/push/deploy routine green work at the end of a turn — the hook does it — but prefer meaningful self-commits (Chinese conventional style) over relying on the hook's generic `chore:` message.

### Code review gate (code-reviewer)

When a turn produces non-trivial code changes — new features, bugfixes, cross-file edits, or anything touching `server/`, auth, or the database — dispatch the `code-reviewer` subagent on the dirty diff **before** self-committing, and fix P0/P1 findings first. This guarantees the auto-release hook only ships reviewed code; skipping it means unreviewed changes reach production at turn end. Skip the gate for trivial edits (copy, formatting, comments). For formal Standards+Spec review against a fixed baseline, run the `code-review` skill instead — that is a different job from this agent.
