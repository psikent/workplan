# 03 离线态与版本更新 UX

Status: resolved

- `apps/web/src/App.tsx` 启动引导增加失败分支：`/setup/status` 与 `/auth/me` 均网络失败时进入「网络不可用 + 重试」界面（BrandMark + 提示文案 + 重试按钮，重试即重跑引导）。
- 新增 `useOnline` hook（`navigator.onLine` + online/offline 事件），AppShell 顶部渲染离线提示条。
- 新增 `ReloadPrompt`：`virtual:pwa-register/react` 的 `useRegisterSW`，`onNeedRefreshToBeShown` 显示「新版本可用 → 刷新」，点击调用 `updateSW(true)`；关闭按钮可暂缓。
- 样式进 `src/styles.css`，遵循现有 token 变量与 kebab-case 命名，**必须补 `:root[data-theme="dark"]` 覆盖**。
- dev 模式（无 SW）下以上组件静默不渲染。

验收：断网刷新不再永远「正在载入…」；离线时出现提示条；模拟 SW waiting 时出现刷新提示，点击后页面刷新为新版本。

Blocked by: 02

## Comments

2026-09-02: 已实现并通过验收（build/typecheck/test 全绿；本地 prod 冒烟：SW 激活、图标 200、离线重试态、重建后更新提示与刷新均验证通过）。详见 spec.md。
