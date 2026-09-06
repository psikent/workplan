# 03 — 全屏交互回归与浏览器验收

Type: task
Status: awaiting-approval
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
