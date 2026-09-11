# Workplan (工作计划)

Personal work-plan management service: Chinese web UI, REST API, SQLite persistence, week/month Gantt, custom fields, recurrence, JSON transfer, Bark push. Production is Linux/systemd-only (`release.mjs`; see README); local dev happens on macOS.

## Commands

pnpm is pinned via `packageManager` — always `corepack pnpm`. Node ≥ 22.

- `corepack pnpm dev` — contracts build + server (127.0.0.1:3002) + web (localhost:5173, proxies `/api` and `/health`).
- `corepack pnpm typecheck` / `test` / `build` — run from the repo root; they build `@workplan/contracts` first. Do not run per-package without that build step.
- Focused: `corepack pnpm --filter @workplan/server test` (vitest, `apps/server/test/`), `--filter @workplan/web test` (vitest, co-located `*.test.tsx`), `--filter @workplan/contracts test` (node --test).
- No ESLint/Prettier: typecheck + tests are the quality gate. Commits in Chinese conventional style (`feat(gantt): …`).

## Layout & boundaries

- `packages/contracts` — single source of truth for Zod schemas/enums/types shared by server and web (`src/index.ts`). Server routes and the web API layer import schemas from here; never redefine them. It resolves from `dist/`, hence the build-first ordering above.
- `apps/server` — Fastify 5 + zod type provider. `routes/` is a thin HTTP layer (schema validation + delegate); business logic lives in `modules/`; persistence in `db/` (drizzle-orm over better-sqlite3, WAL, hand-rolled `migrate.ts`).
- `apps/web` — React 19 + Vite + TanStack Query v5 + react-router 7; frappe-gantt for the timeline; PWA shell. UI baseline: `docs/design/DESIGN.md` + `FIDELITY.md`.
- `scripts/` — `release.mjs` (Linux systemd release), `workplan.mjs` (manual lifecycle, macOS only — never `start`/`stop` on Linux prod), `env-config-export.ts`.

## Docs to read before touching an area

- `CONTEXT.md` — ubiquitous language (Work Plan, Schedule Order, Automatic Status…). Use its vocabulary; it explicitly bans `sortOrder`/manual-rank concepts.
- `docs/adr/` — read the ADRs for the area you touch (e.g. 0003 route capabilities, 0008 server-derived owner conflict, 0011 retired sort order).
- `docs/agents/` — `domain.md`, `issue-tracker.md` (issues live in `.scratch/`), `triage-labels.md`.

## Gotchas

- Colors only via the two `:root` token sets in `apps/web/src/styles.css` (`:root` and `:root[data-theme="dark"]`). Hardcoded literal colors in components or rules are a known regression class.
- better-sqlite3 is one synchronous connection: never hold a manual transaction across an `await` — concurrent writes silently join it or degrade to SAVEPOINTs and exceptions roll back work that isn't yours. Long/streaming tasks must be fully synchronous or use a separate connection.
- Authorization boundary is server-side route capabilities (ADR-0003): viewers get `403 INSUFFICIENT_PERMISSION` from the API. Hiding UI in the web app is UX only, never the security check.
- Dev database is `data/workplan.db` at the repo root, fully separate from prod `/var/opt/workplan-release/data/workplan.db`. One process per database (SQLite writes + built-in scheduler).
- TanStack Query v5: with `keepPreviousData`, `isSuccess` is true during placeholder periods — guard "persist on success" refs with `!isPlaceholderData`; error states drop placeholder data unless pinned via ref.

## Interaction style

The user likes interactive dialogue and wants it used by default: when a requirement, design, or fix involves real decisions, surface them as questions with options and a recommended answer (e.g. `AskUserQuestion` or grilling rounds) instead of assuming or proceeding silently. Keep rounds small and answerable; decisions are the user's, facts are the agent's to look up.

## Pre-dev sync check

The user develops from multiple machines. At the start of every development session, before any work, verify the local tree is current: `git fetch origin`, then compare local `main` against `origin/main` (e.g. `git rev-list --left-right --count main...origin/main`) and note uncommitted changes. If local is behind `origin/main`, confirm with the user first, then update (mind any uncommitted changes; prefer `--ff-only`). Never start development on a stale tree — another machine may have already fixed or changed what you are about to touch.

## GitHub operations

For GitHub-related operations (PRs, issues, API queries, releases), prefer `gh` CLI using its built-in authenticated login (`gh auth`), rather than manual tokens or raw API calls.

## Agent skills

### New feature requests

When the user proposes a new feature or requirement, run the `grill-with-docs` skill: grill the idea with the `grilling` protocol and `domain-modeling` docs, then present the requirements plan (spec + tickets) for approval before developing. Before the grilling starts, use interactive Q&A (`AskUserQuestion`) to remind the user to switch to a stronger model for the session. After the spec and tickets land, offer the user the choice: stop at the docs and implement later, or start implementing now. When the session is about to enter the implementation phase — whether right after that choice or in a later session — use interactive Q&A (`AskUserQuestion`) to remind the user to switch to a lower-tier model first, then start implementing.

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses the single-context layout. See `docs/agents/domain.md`.

### Auto-release hook

Codex uses the tracked `.codex/hooks.json` Stop hook (enabled by `[features].codex_hooks = true` in the user's Codex config) to invoke `.codex/hooks/auto-release-codex.sh`; ZCode and pi may invoke the same underlying `.zcode/hooks/auto-release.sh`. A shared lockfile makes duplicate triggers safe. The underlying hook acts only when the working tree is dirty, local `main` is ahead of `origin/main`, or the production marker (`.zcode/hooks/deployed.sha`) is behind HEAD. It runs `corepack pnpm run typecheck` + `corepack pnpm test`; when green **and** the current dirty tree has a matching `.zcode/hooks/review-approved.sha` produced by `.codex/hooks/approve-review.sh` after the `code-reviewer` subagent reports no P0/P1, it commits (falling back to `--no-gpg-sign` if 1Password signing fails), rebases and pushes to `origin/main`, then releases to hk3 following the `deploy-production` skill (preflight → `release.mjs` → health acceptance) and returns a short Codex result message. Missing or stale review approval only reports “等待 code-reviewer 子代理审查通过” and does not mutate data. Full output goes to `.zcode/hooks/auto-release.log`; the hook never blocks the session. Routine green work need not be committed/pushed/deployed manually; after review, the primary agent records approval with `.codex/hooks/approve-review.sh`.

### Code review gate (code-reviewer)

When a turn produces non-trivial code changes — new features, bugfixes, cross-file edits, or anything touching `server/`, auth, or the database — dispatch the `code-reviewer` subagent on the dirty diff **before** self-committing, and fix P0/P1 findings first. When the diff is large and cleanly separable into unrelated modules, multiple `code-reviewer` subagents may be dispatched in parallel instead, each scoped to one independent module or file group. This guarantees the auto-release hook only ships reviewed code; skipping it means unreviewed changes reach production at turn end. Skip the gate for trivial edits (copy, formatting, comments). For formal Standards+Spec review against a fixed baseline, run the `code-review` skill instead — that is a different job from this agent.
