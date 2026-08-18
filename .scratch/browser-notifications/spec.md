# Spec: Browser Notifications

## Goal

When a Work Plan's start time arrives, the browser shows a system-level notification even when the tab is in the background, so the user does not miss a scheduled work item. The feature is entirely browser-side (Web Notifications API + client-side scheduling): no server storage, no push infrastructure, no service worker.

## Terms

See `CONTEXT.md`: **Work Plan**, **Automatic Status**, **Manual Status Override**, **Recurring Rule**, **Occurrence**, **Editor**, **Administrator**.

## Background facts

- Legacy reminder and notification server APIs were deliberately removed: `/api/v1/notifications` and `/api/v1/tags` return 404 and a `reminders` property is rejected with 422 (`apps/server/test/app.test.ts:816`). This feature must **not** reintroduce server-side reminder storage or notification endpoints.
- At HEAD there is no service worker, no PWA manifest, and no `Notification` API usage in `apps/web`.
- A Work Plan carries `startAt` / `endAt` ISO datetimes; its Automatic Status derives from the time range via `deriveWorkPlanStatus` (pending before start, in_progress during the range, completed after end). A Manual Status Override (e.g. cancelled) supersedes the derived status.
- Recurring Rule Occurrences are independent Work Plans with their own time ranges, so time-based notifications apply to them automatically.
- The web app is served by the same Fastify server from `apps/web/dist`; dev default is `http://localhost:3002`, production port 3000, `APP_BASE_URL` configurable. The Notification API requires a secure context (HTTPS or localhost): on plain-HTTP LAN deployments system notifications are unavailable and the feature must degrade to in-app toasts.
- The app already has an in-app toast system (`ToastProvider.showSuccess`, 3.5s auto-dismiss, aria-live) for visible-page feedback.
- Per-browser preferences follow a versioned localStorage pattern (`workplan:theme:v1`, `workplan:sidebar:v1`); the notification preference should follow the same shape. The web workbench is available to Editors and Administrators, while the Settings page is admin-only — the notification control must live where both roles can reach it (AppShell footer), and it is a per-browser preference, not a per-account setting.

## Requirements

### R1 Permission flow
- An enable switch (bell control in the AppShell footer, visible to both roles) requests permission via `Notification.requestPermission()` on the user gesture.
- `!("Notification" in window)` hides the control; permission `denied` disables it with a short explanation; both fall back to in-app toasts for start reminders.
- The granted/denied state is persisted locally.

### R2 Triggers
- Notify when a Work Plan's **effective status** becomes `in_progress` (its start time is reached) and no Manual Status Override suppresses it.
- Optional lead-time notification (configurable, default 5 minutes before start) for the same condition.
- Completed/overdue transitions are out of scope.
- Deduplicate with the notification `tag` (`workplan:<planId>:start`); clicking a notification focuses the window and opens that Work Plan in the drawer.

### R3 Client-side scheduling
- A scheduler module computes the next relevant instant from the fetched Work Plan list and arms a `setTimeout` to it; it re-arms after data refreshes, on `focus` and `visibilitychange`, and when the browser wakes the tab.
- Only schedule within a bounded horizon (e.g. 7 days) to avoid timer overflow; refetch on wake covers gaps.
- When the document is visible, prefer the existing in-app toast instead of a system notification to avoid duplicate noise.

### R4 UI copy
- Chinese labels consistent with the app: 开启通知, 提前提醒, 浏览器通知已被拒绝 / 当前浏览器不支持通知.

### R5 Persistence
- `localStorage` key `workplan:notifications:v1`: `{ version: 1, enabled: boolean, leadMinutes: number, permission: "granted" | "denied" | "default" }`, loaded/saved with the same defensive parsing as the theme and sidebar preferences.

### R6 Testing (TDD)
- Unit tests for the scheduler with fake timers and a mocked `Notification` (permission states, tag dedupe, horizon cap, visibility fallback, click → focus + open).
- RTL tests for the AppShell bell control (enable/disable, denied state, unsupported browser).
- No server tests needed; the server must keep rejecting legacy notification endpoints.

## Out of scope
- Web Push / service workers / background sync; server-side reminders or a notification center; per-account (server-stored) preferences; email or other channels; completion/overdue notifications.
