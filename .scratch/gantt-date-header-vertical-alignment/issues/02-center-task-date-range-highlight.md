# 02 — 任务日期范围高亮块纵向居中
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src

## 背景

票据 01 把 `.lower-text` 日期层在表头内容区内纵向居中（中心从 21px 移到 24.5px），但表头内同坐标系的另一组元素没有跟随：frappe 为每个任务在 `.lower-header` 里预置的 `.date-range-highlight`（悬停任务条 200ms 后显示的灰色圆角日期范围块，bar.js 构造时创建、带 `.hide`）。它的纵向位置来自 frappe 固定样式 `top: 5px; height: calc(--gv-lower-header-height - 6px) = 34px`，中心落在 22px——比修复后的数字层中心高 2.5px，悬停任务时范围块与日期数字视觉错位。

## 改动清单

1. `GanttTimeline.tsx`：`alignDateHeaderContentVertically` 的处理对象从 `.lower-text` 扩展为 `.lower-text, .date-range-highlight`，沿用同一几何公式（表头内容区居中）；元素 rect 高度为 0（`.hide` 态 display:none）时回退读取 `getComputedStyle` 解析出的 CSS 高度，避免悬停显示时回落到 frappe 固定 top。
2. `GanttTimeline.render.test.tsx`：新增用例覆盖隐藏态范围块（rect 全零 + computed 34px）与日期层同时居中、中心差 ≤1px、重复调用不漂移。

## 验收

- 49px 表头内容区、34px 范围块：中心差 ≤1px（公式 top=7.5px），与 32px 日期层（top=8.5px）中心重合。
- 隐藏态（display:none）也能完成校正，悬停显示即居中；拖拽改排只更新 left/width，不影响 top。
- 定向测试、Web 全量测试、Web typecheck 通过；真实浏览器悬停实测中心差 0px。

## Comments

2026-09-02（完成记录）：

- 复现测量（修复前）：范围块中心 246 vs 表头内容中心 248.5，偏上 2.5px；数字层 inline top=8.5px 居中正常。
- 修复后浏览器实测（周视图悬停第一条任务）：范围块 inline top=7.5px，中心 248.5，与表头内容中心/数字层中心差 0px；亮暗主题一致。
- `GanttTimeline.render.test.tsx` 43/43 通过（新增 1 例）；Web 全量 261/261 通过；Web typecheck 通过。
