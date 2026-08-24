# 重复周期 UI（web）
Type: task
Status: resolved
Blocked by: 05, 06

## 背景
规格 R10 Web 部分。在月目标页新增重复周期设置、系列归属徽标与系列管理对话框。
## 改动清单
1. apps/web/src/pages/MonthlyGoalsPage.tsx：
   - 新建/编辑抽屉增加「重复周期」区块（不重复/每月/每季度/每年 + 间隔 1..12 + 结束方式：共 N 期 或 到某年某月，至少一项；设置为周期时 POST /monthly-goal-series，首期=表单所属月份）。
   - 实例行显示系列徽标（Repeat2，title 摘要「每 {interval} 个月重复 · 第 {k}/{n} 期」），点击打开系列管理对话框。
   - 系列管理对话框：规则展示/编辑（PATCH，含 optimistic lock 409 处理）、已生成期列表、停止生成（确认文案：停止后不再生成，已生成的月目标保留）。
2. styles.css：系列徽标与管理对话框样式（遵循 DESIGN.md 既有类名习惯）。
3. 标签与文案按 R10；与全站中文风格一致。
## 验收
- 新建/编辑时设置重复周期后,列表出现该期全部实例(当期即首期)。
- 实例行有系列徽标;打开系列对话框可改规则、查看期列表、停止生成。
- 实例本身仍可独立编辑/归档/恢复/删除;页面样式与既有页面一致。

## Comments

### 2026-08-22 实现摘要

- **MonthlyGoalsPage.tsx 扩展**：
  - 新建抽屉新增「重复周期」区块（form-section：频率 不重复/每月/每季度/每年；间隔 1..12（非重复禁用）；结束方式 共 N 期 / 到某年某月（年 2000-2100 + 月 1-12 选择）；仅新建时展示，编辑实例不展示）。客户端校验期数 ≥1；提示文案「保存后将立即生成从 {Y} 年 {M} 月起的独立月目标实例，每期可单独编辑与关联任务」。
  - saveMutation 扩展：series 分支 POST /api/v1/monthly-goal-series（template/frequency/interval/startPeriod=表单所属年月/occurrenceCount 或 untilPeriod），返回类型 `MonthlyGoal | { series }`。
  - 实例行：seriesId 存在时在操作区首位渲染 Repeat2 徽标（title=「每月重复 · 共 N 期」「每 2 个月重复 · 共 N 期」等，来自 /monthly-goal-series 列表映射），点击打开系列对话框。
  - **SeriesDialog**（新组件，同文件内）：GET /:id 详情；规则编辑（频率/间隔/结束方式，PATCH + version，409 →「数据已被修改，请刷新后重试」并刷新详情）；已生成期列表（期次 + 标题 + 已归档标记）；「停止生成」danger 按钮（确认文案：停止后不再生成后续月目标，已生成的实例保留）；停止后显示「（已停止）」、按钮变禁用「已停止」。
  - refreshGoals 同步失效 ["monthly-goal-series"]。
- **样式**（styles.css）：`.series-dialog` / `.series-dialog-meta` / `.series-instance-list` / `.series-instance` / `.field-dialog-footer`（沿用 field-dialog / form-section / field 既有 token）。
- **踩坑**：重写文件时曾丢失 submit() 的 try/catch（原实现有「错误由 onError 处理」的吞错包装），导致 409 场景产生 unhandled rejection（vitest Unhandled Rejection 暴露）——已恢复。
- **验证**：MonthlyGoalsPage.test.tsx 10/10（新增 2 例：系列 payload 提交与实例渲染、徽标→对话框编辑/停止）；web 全量 146/146；typecheck 全绿。
