# 04 — 手势导航回归与浏览器验收

Type: task
Status: resolved
Blocked by: 01, 02, 03
Spec: ../spec.md
Scope: apps/web/src/pages/WorkPlansPage.test.tsx、apps/web/src/components/GanttTimeline*.test.tsx、必要的 `.scratch/timeline-swipe-navigation/qa/` 验收脚本与记录

## 背景

规格 Testing requirements 与 Acceptance criteria。该功能处于浏览器原生滚动、Pointer Events、Frappe Gantt DOM、异步查询和移动端边缘导航的交叉区域，需要自动化回归及真实渲染验收共同收口。

## 改动清单

1. 补齐规格要求的日期运算、状态机、DOM 事件委托、滚动边界、页面状态、加载/错误和连续导航自动化测试。
2. 回归鼠标、触控板/滚轮、触控笔、纵向触摸滚动、甘特条交互、日期网格双击、提醒铃铛、分页、全屏和抽屉/浮层边界。
3. 使用隔离本地实例做浏览器验收：浅色/深色，约 390px 手机与平板宽度，周/月，列表展开/收起，普通/全屏，空数据、加载和失败状态。
4. 在浏览器触摸仿真中复核方向、阈值、反馈、松手撤销、300ms 冷却、范围内滚动与边界二次滑动；具备设备条件时补充 iOS/Android 原生边缘手势记录，不能验证时明确保留限制。
5. 运行相关 Web 专项测试，以及根目录 `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 和 `git diff --check`。
6. 非平凡代码变更在交付前 dispatch `code-reviewer` 审查 dirty diff，修复全部 P0/P1，并通过 `.codex/hooks/approve-review.sh` 记录审查批准。

## 验收

- 自动化覆盖规格所有成立、取消、冲突、状态保留、加载/失败和日历边界，且相关测试全部通过。
- 浏览器验收确认浅/深色反馈清晰、窄屏和平板无额外页面溢出、普通/全屏均可用，原生滚动和既有甘特交互无回归。
- 无法进行的真实设备检查被明确记录，不以触摸仿真冒充 iOS/Android 实机验证。
- 根质量门、`git diff --check` 和 code-reviewer 审查全部通过，无未处理 P0/P1。

## Comments

- 本票不扩大到服务端、数据库、权限模型、触控板手势或浏览器原生边缘导航改造。
