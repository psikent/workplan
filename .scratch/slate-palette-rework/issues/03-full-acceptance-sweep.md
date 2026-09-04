# 03 — 全站深浅双主题验收清扫
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/dist（QA 产物）、.scratch 记录

## 背景

规格验收标准 2–4。票据 01/02 完成后的独立验收票：按历史教训（新增类漏暗色覆盖 ×2），对全部页面做深浅双主题清扫，而不是只查改动过的页。

## 改动清单

1. 本地构建 + 隔离实例（DATA_DIR 临时目录、副本库注入临时账号）跑起生产版前端。
2. 无头 Chromium 截图矩阵：页面 {登录、工作计划列表、周时间轴、月时间轴、工作台、月目标、月目标年度快捷编辑、设置各页（字段/账户/导出/env-config/Bark）、排序面板展开、各弹层/toast} × 主题 {浅、暗} × 视口 {桌面 1280、移动 390}，逐张检查。
3. 对比度抽验：正文 ≥4.5:1、弱文字 ≥3:1（对各自底盘）。
4. 发现的问题小修直接修入 01/02 范围（styles.css），大的另立票。

## 验收

- 截图矩阵无白块/旧色残留/不可读文本；问题清单（如有）已闭环。
- `pnpm run typecheck` + `pnpm test` 全绿。

## Comments

- 2026-09-05 创建。QA 配方见 memory：browser-qa-headless-chromium-fallback / workplan-dev-browser-qa-login。

## Answer

- 截图矩阵 20 张（light/dark × 桌面 1280 × 移动 390 × 7 类页面 + 双主题登录页），逐张人工检查通过；产物在 /tmp/wp-slate-qa/shots/（临时目录）。
- grep 验收：styles.css 两套 :root 之外颜色字面量 0 处。
- 对比度（WCAG）：dark 正文 14.5:1 / 弱文字 6.96:1；light 正文 17.9:1 / 弱文字 4.55:1；语义徽章文字/软底 6.2–9.6:1；唯一贴线项：浅色主按钮白字对 #6366f1 = 4.47:1（13px 加粗标签，AA large 达标，记录备查）。
- `pnpm run typecheck` 全绿；测试 contracts 20 / server 165 / web 268 全过。
- 发现并就地修复：登录输入框无背景色问题（并入票据 01）。
- 另立票据 04（needs-triage）：登录/开机页 SystemTheme 覆盖存储主题偏好（既有行为，非本次引入）。
