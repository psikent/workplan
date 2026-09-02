# 01 — 甘特图日期层纵向居中
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src

## 背景

Frappe Gantt 的可见表头为 50px，但日期层仍按默认 `top: 5px`、高度 32px 布局，导致日期数字、提醒铃铛和当日背景整体上偏约 3–4px。按规格 R1–R3 做实际 DOM 几何归一，不使用固定像素补偿。

## 改动清单

1. `GanttTimeline.tsx`：新增并导出仅供内部测试使用的 `alignDateHeaderContentVertically(mount)`；按 `.grid-header` 内容区和 `.lower-text` 实际尺寸计算绝对 `top`，处理缺失/零尺寸元素并保证幂等。
2. 提醒铃铛注入后立即执行校正，并在现有布局 `requestAnimationFrame` 中重试；保持 `alignCurrentDateMarker` 及圆点/竖线纵向位置不变。
3. `GanttTimeline.render.test.tsx`：覆盖中心差、多个日期层同基线、重复调用、缺失/零尺寸安全退出，并复跑现有当日标记与提醒铃铛测试。
4. 完成规格所列自动验证和真实浏览器代表性矩阵验收。

## 验收

- 规格验收标准 1–6 全部满足。
- 完成后把本票状态改为 `resolved`，在 `## Comments` 记录测试和浏览器证据。

## Comments

2026-09-02（完成记录）：

- 根因确认：Frappe Gantt 在 49px 可见内容区内仍使用 `top: 5px`、32px 高日期层，中心上偏 3.5px；新增 DOM 几何归一后实际 `top` 为 8.5px。
- 新增 `alignDateHeaderContentVertically`，在提醒铃铛注入后和布局稳定后的 `requestAnimationFrame` 各执行一次；直接计算绝对位置，重复调用不累计漂移。
- 定向测试先以 2 例失败建立红灯，实施后 `GanttTimeline.render.test.tsx` 42/42 通过；Web 全量测试 259/259、Web typecheck、全仓 typecheck 均通过。
- 真实 Edge 验收：
  - 1280×844、亮色、周视图展开、当天带铃铛：7 个日期层同一 `top`，最大中心误差 0px。
  - 1280×844、深色、月视图收起、无铃铛：30 个日期层同一 `top`，最大中心误差 0px。
  - 390×844、深色、周视图自动收起：7 个日期层同一 `top`，最大中心误差 0px。
  - 干净重载单独捕获 console warning/error 与 pageerror，结果为空数组。
