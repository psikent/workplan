# 02 — 测试与回归
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src

## 背景

规格验收标准 3、4、7 的自动化覆盖。

## 改动清单

1. `WorkPlansPage.test.tsx`（或新增 co-located 测试文件）：
   - 点击收起按钮 → 左栏隐藏、收起条（展开按钮 + 标题）出现；再点展开恢复。
   - 桌面端收起写入 `workplan:planner-collapsed:v1`，加载时恢复收起态。
   - `matchMedia` mock ≤720px → 初始即收起；手机端手动展开后 localStorage 无写入。
   - 收起条标题文案：周视图「X月第N周」、月视图「YYYY 年 M 月」。
2. 跑 `corepack pnpm --filter @workplan/web test`、`corepack pnpm --filter @workplan/web typecheck`、根 `typecheck`。

## 验收

- 规格验收标准 7 全绿。

## Comments

2026-08-31（完成记录）：

- `WorkPlansPage.test.tsx` 新增 `task list collapse` 3 例：收起/展开切换与周/月标题、桌面持久化跨渲染恢复、手机（matchMedia stub ≤720px）初始收起且手动展开不写 localStorage。
- `GanttTimeline.render.test.tsx` 新增 1 例：`taskListCollapsed` 时不挂接滚动同步（回归保护，替代被否决的 offsetWidth 启发式）。
- `corepack pnpm --filter @workplan/web test` 249/249 通过；web 与全仓 typecheck 通过。
- 浏览器实测（dev 站点，1280px 桌面 + 390px 手机视口）：桌面收起/展开/刷新保持、周/月标题一致、手机自动收起、手动展开仅会话内、跨断点恢复持久化值 —— 验收 1–6 全过。
