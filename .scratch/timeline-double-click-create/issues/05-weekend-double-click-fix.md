# 05 — 修复周末列无法双击新建（frappe 周末高亮层拦截）

**What to fix:** 周六、周日列双击无法新建工作计划，悬停也不显示「双击新建工作计划」提示。这是对 spec R2（周末允许新建）与 R5（悬停反馈）的回归，违反验收标准 6、7。

**Root cause:** frappe-gantt 1.2.2 默认 `holidays: {'var(--g-weekend-highlight-color)': 'weekend'}` 会在每个周六/周日列绘制 `.holiday-highlight` 矩形（周末浅灰底色），与 `.grid-row` 同层且绘制在其上方。`configureDateCellCreation` 的双击守卫只接受 `.grid-row` 命中，`configureDateCellAffordance` 把 pointerenter/pointermove 绑在 `.grid-row` 上，周末列的指针事件全部落在覆盖矩形上被吞掉。现有测试直接对 `.grid-row` 派发事件（jsdom 无命中测试），因此未暴露。

**Fix:**

- 渲染后对 `.holiday-highlight` 设置内联 `pointer-events: none`（`disableWeekendHighlightHit`），覆盖层不再截获指针，双击与悬停提示恢复；frappe 自身基于 `.grid-row` 的取消选中逻辑不受影响。
- 双击守卫兜底扩展为 `.grid-row, .holiday-highlight`：即使覆盖层命中也按日期格处理。
- 回归测试：对周末 `.holiday-highlight` 真实派发 dblclick 断言回调收到周六日期（修复前必红，已反向验证）；新增周六列坐标映射用例。抽屉 `08:30–18:00` 预填逻辑与日期无关，已有 `WorkPlanDrawer` 测试覆盖（用例日期 2026-08-15 即周六），不重复添加。

**Blocked by:** None.

Status: resolved

- [x] 周视图和月视图的周六、周日列均可双击打开预填新建抽屉，日期按本地日历映射正确。
- [x] 周末列悬停恢复仅当前日期格高亮及「双击新建工作计划」提示。
- [x] 工作日、甘特条、日期表头的既有交互无回归（既有 41 项渲染测试全部通过）。
