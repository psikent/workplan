# Spec: Browser Notifications

> Status: **已取代（superseded，2026-08-20）** — 本规格由 `.scratch/work-plan-reminders/spec.md` 取代，不再按此实现。原「不新增任何服务端提醒/通知存储与端点」约束修订为：legacy 提醒/通知 API 的 404/422 回归保持不动，但允许新增**只读**提醒推导端点（`/api/v1/reminders`，零提醒存储）。票据 `issues/01`–`03` 原样存档。
>
> 票据索引：01 通知调度器 | 02 AppShell 铃铛控制与持久化 | 03 测试与回归。依赖：01 → 02 → 03。

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

## 票据索引

- 01-notification-scheduler.md — 通知调度器（lib/notifications.ts：计算下次触发、setTimeout、重排、去重、可见性降级）
- 02-bell-control-and-persistence.md — AppShell 铃铛控制与本地持久化（权限流程 + workplan:notifications:v1）
- 03-tests-and-regression.md — 调度器/控制组件测试与既有「tag/reminder/notification 已移除」回归

依赖：01 → 02 → 03。

## 验收标准（Acceptance criteria）

1. 工作计划进入 in_progress（到达开始时间且无手动状态覆盖抑制）时，后台标签页弹出系统通知；同一计划的开始通知由 tag 去重，仅触发一次。
2. 权限流程：铃铛开关在用户手势中调用 Notification.requestPermission()；granted/denied 状态持久化；denied 或浏览器不支持（"Notification" in window 为假）时禁用开关并给出中文说明，降级为应用内 toast。
3. 可选提前通知（默认 5 分钟）作用于同一条件；完成/逾期转换不在范围。
4. 调度器仅在 7 天水平线内布防，数据刷新 / focus / visibilitychange / 浏览器唤醒后重排；文档可见时优先应用内 toast 而不是系统通知，避免重复打扰。
5. localStorage workplan:notifications:v1 采用与 theme/sidebar 相同的防御式读写；存储失败回退默认且不影响工作台。
6. 全部既有测试通过；服务端继续拒绝 /api/v1/tags、/api/v1/notifications 与 tags/reminders 属性（不恢复任何服务端提醒/通知存储）。
