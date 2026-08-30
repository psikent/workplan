# 01 — 移动端「工作台」导航标签修复
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src/styles.css

## 背景

规格 R4。≤720px 媒体查询中 `.sidebar-collapse, .sidebar-nav .nav-item:nth-child(1) { display: none; }` 自基线提交（c507752）起把第一项导航（工作台）整个隐藏，手机端只能靠 URL 进入 `/overview`。

## 改动清单

1. 删除该规则中的 `.sidebar-nav .nav-item:nth-child(1)` 选择器，仅保留隐藏折叠按钮。

## 验收

- 移动端顶栏可见 工作台 / 工作计划 / 月目标 /（管理员的）设置；web build 通过。

## Answer

- `apps/web/src/styles.css:591`：规则改为 `.sidebar-collapse { display: none; }`。
- `corepack pnpm --filter @workplan/web build` 通过（2026-08-30）。
