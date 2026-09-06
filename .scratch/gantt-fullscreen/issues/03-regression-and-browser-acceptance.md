# 03 — 全屏交互回归与浏览器验收

Type: task
Status: resolved
Blocked by: 01, 02
Spec: ../spec.md
Scope: apps/web/src/pages/WorkPlansPage.test.tsx、apps/web/src/components/GanttTimeline.render.test.tsx、必要时新增页面测试夹具与 `.scratch/gantt-fullscreen/qa/`

## 背景

规格 Testing requirements 与验收标准 1–8。全屏同时影响应用壳层、页面级查询控件、甘特面板尺寸、浮层、抽屉和键盘事件，需要自动化回归与真实窄屏/桌面检查。

## 改动清单

1. 页面测试覆盖按钮位置语义、动态标签、点击进入/退出、`Esc`、刷新初始态和全屏时页面级元素隐藏/面板元素保留。
2. 页面测试覆盖进入全屏时关闭已打开浮层但保留搜索/筛选/排序值；全屏中打开抽屉，抽屉 `Esc` 优先关闭，第二次 `Esc` 退出。
3. 渲染/组件测试确认全屏状态不改变 Gantt 业务 props、日期范围、视图、显示属性、只读权限、列表折叠和现有甘特事件。
4. 启动隔离本地实例做浏览器验收：浅色/深色 × 桌面/约 390px 窄屏，检查面板填充、按钮位置、列表切换、横向/纵向滚动恢复、抽屉覆盖和退出布局；保存必要截图或记录到本目录。
5. 运行 Web 专项测试、Web typecheck、Web build；非平凡代码变更在提交前 dispatch `code-reviewer` 审查，P0/P1 发现先修复。

## 验收

- 自动化测试覆盖规格列出的交互与状态边界并全部通过。
- 浏览器桌面与窄屏验收确认无页面级溢出、无焦点/键盘回归，抽屉和既有甘特交互保持正常。
- Web 测试、typecheck、build 和 `git diff --check` 通过；审查无未处理 P0/P1。

## Comments

- 本票不扩大到服务端、数据库、导出或权限测试；这些区域由规格 R5 明确保持不变。
- 2026-09-06 完成页面测试 7 项（`WorkPlansPage.test.tsx` 的 `gantt fullscreen mode` 组）：按钮位置语义与动态 aria-label、全屏时根类名与面板保留、Esc 分层（浮层→退出、抽屉优先）、进入关闭浮层且查询值保持、切换前后 `GanttTimeline` 业务 props 不变（含折叠态）、卸载/重挂载复位。GanttTimeline 组件本身零改动，渲染测试无需扩展。
- 浏览器验收脚本：`qa/screenshot.cjs`（浅/深 × 1440/390 × 普通/全屏截图 + 布局指标）与 `qa/interactions.cjs`（16 项交互断言：滚动保持按新容器钳制、抽屉 Esc 优先、浮层关闭、退出恢复、刷新复位、周视图 Esc 退出），截图存 `qa/shots-baseline/`、`qa/shots-fullscreen/`。结果全部 PASS。
- code-reviewer 审查：1×P0（Esc 退出不写滚动快照）、1×P1（恢复循环错误早退捷径）已修复；P2 查询错误横幅豁免全屏隐藏；P3（event.repeat、closePlanDrawer 共用）已采纳。复核通过，无未处理 P0/P1。
- Web 测试 296 全过、typecheck、build、`git diff --check` 通过。
