# 04 — 登录/开机页应尊重存储的主题偏好
Type: task
Status: resolved
Spec:
Scope: apps/web/src/App.tsx（SystemTheme 组件）

## 背景

slate-palette-rework 验收（票据 03）时发现：`index.html` 的内联脚本开机时正确读取 `workplan:theme:v1` 并设置 `data-theme`，但匿名路由（登录页/开机屏）挂载的 `SystemTheme` 组件（App.tsx:62-68）随后无条件 `applyTheme(systemTheme)`，把用户存储的 dark 偏好覆盖成系统主题。结果：偏好 dark 的用户在登录页看到浅色（若系统是浅色），进入应用后才变暗——有闪变且不一致。无头 Chromium（prefers-color-scheme: light + 存储 dark）实测 `htmlTheme` 从 dark 被改写为 light。

## 建议改法

`SystemTheme` 先读存储偏好：preference 为 light/dark 时 applyTheme(该值)，为 system（或无存储）时跟随系统；系统主题变化监听仅在 preference === "system" 时生效。注意与 AppShell 内的主题切换按钮状态保持同一数据源。

## 验收

- 存储 dark + 系统浅色时，登录页、开机屏为暗色且无闪变；system 偏好行为不变；既有 AppShell 主题测试全绿。

## Answer

- `loadThemePreference`/`ThemePreference`/`themePreferenceKey` 从 AppShell 上移到 `apps/web/src/lib/theme.ts` 作为单一数据源，AppShell 改为导入（行为不变）。
- App.tsx 的 `SystemTheme` 重命名为 `StoredTheme`：存储偏好为 light/dark 时始终应用该值（不随系统翻转），为 system（或无存储/损坏）时跟随系统；存储偏好在 App 每次渲染时重读，覆盖「登录期间在 AppShell 切换主题后登出」的场景。
- 新增测试 2 条：存储 dark + 系统浅色 → 登录页暗色且不随系统翻转；存储 light + 系统暗色 → 保持浅色。原 3 条登录主题测试不变全过。
- 验收：typecheck 全绿；测试 contracts 20 / server 165 / web 270 全过；无头 Chromium 实测 stored dark + prefers-color-scheme: light → 登录页 `data-theme="dark"`，截图确认无闪变、无白块。
