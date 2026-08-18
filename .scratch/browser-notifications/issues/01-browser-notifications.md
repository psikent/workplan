# 01 — Browser Notifications: client-side notification feature

Status: needs-triage
Blocked by: none
Spec: ../spec.md
Scope: apps/web/src (new lib/notifications.ts + AppShell bell control), their tests

## Task

Implement the browser-level notification feature per `../spec.md`:

- `lib/notifications.ts`: scheduler module — computes the next in_progress (or lead-time) instant from the fetched Work Plans, arms `setTimeout` with a bounded horizon, re-arms on data refresh / focus / visibilitychange, fires `new Notification(title, { body, tag, icon })` when the document is hidden, and falls back to `useToast` when visible or when permission is missing/denied. Click focuses the window and opens the Work Plan drawer.
- AppShell: a bell enable control in the sidebar footer (both roles), Chinese labels, hidden when `Notification` is unsupported, disabled with explanation when denied.
- Persistence: `workplan:notifications:v1` in localStorage with the same defensive parsing as theme/sidebar preferences.

## Acceptance (tests first)

- Scheduler tests with fake timers: arms exactly the next relevant instant; lead-time variant; tag dedupe; horizon cap; re-arms on refresh/wake; visible-page toast fallback; click focuses and opens the plan.
- AppShell tests: enabling requests permission; denied disables with explanation; unsupported browser hides the control; preference round-trips through localStorage.
- Web typecheck, full Web suite and workspace production build stay green; server keeps returning 404 for `/api/v1/notifications`.

## Open questions (triage)

- Default `leadMinutes` (5?) and whether lead-time is per-browser only or a per-Work-Plan opt-out later.
- Notification icon: reuse the existing BrandMark asset or ship a dedicated small icon.
