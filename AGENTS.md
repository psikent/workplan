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

A workspace-scoped ZCode `Stop` hook (`gitignored` `.zcode/config.json`) runs `.zcode/hooks/auto-release.sh` after every agent turn. It acts only when the working tree is dirty, local `main` is ahead of `origin/main`, or the production marker (`.zcode/hooks/deployed.sha`) is behind HEAD. It runs `pnpm run typecheck` + `pnpm test`; when green it commits (falling back to `--no-gpg-sign` if 1Password signing fails), rebases and pushes to `origin/main`, then releases to hk3 following the `deploy-production` skill (preflight → `release.mjs` → health acceptance) and records the deployed SHA. All output goes to `.zcode/hooks/auto-release.log`; the hook never blocks the session. Because of this, there is no need to commit/push/deploy routine green work at the end of a turn — the hook does it — but prefer meaningful self-commits (Chinese conventional style) over relying on the hook's generic `chore:` message.

### Code review gate (code-reviewer)

When a turn produces non-trivial code changes — new features, bugfixes, cross-file edits, or anything touching `server/`, auth, or the database — dispatch the `code-reviewer` subagent on the dirty diff **before** self-committing, and fix P0/P1 findings first. This guarantees the auto-release hook only ships reviewed code; skipping it means unreviewed changes reach production at turn end. Skip the gate for trivial edits (copy, formatting, comments). For formal Standards+Spec review against a fixed baseline, run the `code-review` skill instead — that is a different job from this agent.
