# 05 — 修复 --canvas token 漏定义导致透明区域露出浏览器默认灰底
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src/styles.css

## 背景

票据 01/02 交付后用户反馈（2026-09-05 截图）：暗色下工作计划页页头 + 筛选行区域底色为中性灰（用户浏览器实测 #1e1e1e），与下方藏青面板形成明显色差。本地无头 Chromium 复现为 #121212（Chromium 暗色 color-scheme 的 UA 默认画布色）。

## 根因

重写两套 `:root` 时遗漏了 `--canvas` 的定义（旧浅色 `#f6f8fb`/旧暗色 `#101316` 未迁移）。`html`/`body` 的 `background: var(--canvas)` 以及 `.settings-tabbar`、`.goal-link-current`、`.env-config-preview-section > header`、`.annual-quick-edit-table thead th`、`.owner-mapping-table th`、`.export-column-head` 等使用 `var(--canvas)` 的规则全部变成无效值 → 透明，露出 UA 默认画布色；所有显式 `--surface` 的面板正常，因此只在页头等透明区域露馅。当时 token 完整性校验曾报出 `--canvas` missing，被误判为「同块先引用后定义」而放过。

## 修复

- 浅色 `:root` 补 `--canvas: #f8fafc`，暗色 `:root[data-theme="dark"]` 补 `--canvas: #020617`。
- 重跑 token 完整性校验：missing defs 仅剩 TSX 内联注入的 `--plan-grid-*`（预期），无未使用 token。

## 验收

- 无头 Chromium 实测：`html`/`body` computed background = rgb(2,6,23)；截图取样页头间隙、筛选行均为 #020617，计划面板 #0f172a。
- `pnpm run typecheck` 全绿；全套测试通过（首次运行的 viewer-authorization 失败为并行负载超时抖动，隔离重跑 6/6 通过、全套 exit=0）。

## Comments

- 2026-09-05 创建并随修复提交闭环。

## Comments（追加）

- 2026-09-05 复发记录（ba89837）：`.search-control input` 同样从未设置背景（wrapper 有 --surface 底，input 露 UA 控件灰）。已补 `background: transparent` 并发布；同时全文件扫描 input/select/textarea 规则，确认这是最后一处无背景的文本输入（其余或显式设背景、或为 checkbox 仅用 accent-color）。经验：迁移 wrapper 背景时，内部原生 input 的 UA 默认底要显式置 transparent。
