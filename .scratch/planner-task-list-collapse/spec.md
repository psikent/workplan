# Spec: 计划视图任务列收起（Planner Task List Collapse）

> Status: **已交付** — 票据 01–02 已 resolve（2026-08-31）；单测 249/249、全仓 typecheck 通过；桌面/手机浏览器实测验收 1–6 全过。

## Goal

工作计划页的甘特视图支持把左侧任务列表（工作内容 / 负责人 / 状态 / 起止时间等列）整体收起，只展示甘特条；手机访问自动收起。展开后恢复原分栏。

## Decisions（grilling 2026-08-31，用户已确认）

- **D1 收起布局**：时间轴占满全宽；时间轴左上角出现悬浮小条 = 展开按钮 + 周/月标题（文案与展开态一致）。
- **D2 状态记忆**：桌面端收起状态持久化（localStorage `workplan:planner-collapsed:v1`，沿用侧边栏 `{version:1, …}` 模式）；周视图与月视图共用同一开关。
- **D3 移动端**：≤720px（全站移动端断点）每次加载自动收起；手机上允许手动展开，但仅本次会话生效、不写入持久化。
- **D4 按钮位置**：展开态按钮在左栏工具条第 1 列（周标题左侧，现有空列，即截图标记处）；收起态按钮在时间轴左上角小条内。

## Background facts

- 分栏布局：`.planner-panel` 为 `minmax(0, var(--planner-list-width, 44%)) | 8px 分隔条 | 1fr` 三列网格（`apps/web/src/styles.css`）；周标题渲染于左栏 `.table-toolbar > strong`（grid-column 2），第 1 列当前为空 —— 即截图标记位置。
- 分栏宽度已有持久化先例 `workplan:planner-split:v1`；侧边栏折叠先例 `workplan:sidebar:v1`。
- 甘特条拖拽/缩放为自研实现，数学只依赖 `.gantt-mount` 宽度（ResizeObserver → columnWidth → 图表重建）；左栏收起只改变时间轴宽度，不破坏拖拽。
- `.plan-rows` 与甘特通过 `verticalScrollPeerRef` 做纵向滚动同步；收起后 peer 隐藏，需要容错。
- 720px 断点目前仅存在于 CSS 媒体查询，无 JS 探测，需要新增 `matchMedia` 监听。

## Requirements

### R1 切换按钮（展开态）

- 位置：`.table-toolbar` grid 第 1 列（`justify-self: start`），样式对齐现有 `icon-button`。
- `aria-label="收起任务列表"`、`aria-expanded`；点击收起。

### R2 收起态布局

- `.planner-panel` 追加 collapsed 修饰类：左栏与分隔条宽度归零隐藏，时间轴占满全宽。
- 时间轴左上角渲染收起条：展开按钮（`aria-label="展开任务列表"`）+ 周/月标题（文案与展开态一致：周视图「8月第5周」、月视图「2026 年 8 月」）；与既有 absolute 控件（range controls / 视图切换 / 甘特条属性）不重叠，必要时收起态下 range controls 让位。
- 列设置按钮、任务表头、任务行、table-footer 随左栏隐藏。

### R3 状态模型

- `collapsed: boolean`；初始值 = 手机视口（≤720px）? 收起 : 持久化值。
- 手动切换：桌面写持久化；手机仅会话内生效、不写持久化。
- 视口跨断点变化时重算默认值（进入手机 → 收起；回到桌面 → 持久化值），手动 override 保持到下一次跨断点或刷新。
- 周视图 / 月视图共用一个状态。

### R4 展开恢复

- 恢复收起前的分栏宽度（不动 `workplan:planner-split:v1`）；左栏内容原样恢复。

### R5 滚动同步与甘特重算

- 收起时纵向滚动同步对缺失/隐藏 peer 容错；展开后恢复同步。
- 收起/展开触发甘特日列宽重算与图表重建（现有机制），无控制台报错。

## Out of scope

- 工具条整行横跨全宽的重构（已否决）；后端改动；移动端分栏展开态的窄屏优化；frappe 表头样式调整。

## 验收标准

1. 桌面端点击工具条左侧按钮：左栏与分隔条消失，时间轴满宽，左上角出现 [展开按钮 + 标题]；再点击恢复原分栏与全部内容。
2. 收起条标题文案与展开态一致（周「8月第5周」/ 月「2026 年 8 月」）。
3. 桌面收起后刷新页面仍收起（`workplan:planner-collapsed:v1`）；展开后刷新仍展开。
4. ≤720px 视口加载自动收起；手动展开仅本次会话有效，刷新后仍自动收起，且不写 localStorage。
5. 周视图收起后切到月视图仍收起（共用）。
6. 收起/展开后甘特列宽正确重算，条拖拽/缩放照常工作。
7. web typecheck、vitest、全仓 typecheck 通过。
