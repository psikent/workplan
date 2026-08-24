# 月目标配置页与任务侧标签（web）
Type: task
Status: resolved
Blocked by: 01, 02

## 背景
规格 R2/R5/R6/R9。实现独立配置页、导航与路由、任务抽屉多选与列表 chips。
## 改动清单
1. apps/web/src/components/AppShell.tsx：navItems 增加「月目标」（adminOnly: false）。
2. apps/web/src/App.tsx：注册 /monthly-goals 路由（无 admin 守卫）。
3. 新建 apps/web/src/pages/MonthlyGoalsPage.tsx：月份选择、目标列表、月度汇总、新建/编辑抽屉、关联/解绑任务、归档/恢复/删除；标签与文案按 R9；布局遵循 DESIGN.md。
4. apps/web/src/components/WorkPlanDrawer.tsx：新增「月目标」多选区块，保存时提交 monthlyGoalIds；服务端错误回显为表单错误。
5. apps/web/src/pages/WorkPlansPage.tsx：PlanRow 显示目标标签 chips；提供目标列表数据源给抽屉（useQuery 复用 /monthly-goals）。
## 验收
- 管理员与编辑者均可见「月目标」导航并可完成全部配置操作。
- 新建/编辑任务时多选月目标保存后回显 chips；目标页与任务侧双向改关联一致。
- 月份切换、归档/恢复、删除确认、乐观锁冲突提示均可用。
- 页面样式与既有页面一致（白画布、导航、抽屉、状态徽标）。

## Comments

### 2026-08-22 实现摘要

- **导航与路由**：AppShell navItems 增加「月目标」（Target 图标，adminOnly: false，管理员与编辑者均可见）；App.tsx 注册 `/monthly-goals`（lazy + 无 admin 守卫）。
- **MonthlyGoalsPage**（新页面 apps/web/src/pages/MonthlyGoalsPage.tsx）：
  - 月份选择（年 2000–2100 + 月 1–12，默认当前月），清单始终按 `includeArchived=true` 拉取、前端按「显示已归档」开关过滤；
  - 月度汇总「本月已完成 X / Y 个目标」（只计非归档，completed=派生状态 completed）；
  - 目标列表：名称/所属月份/说明/关联任务（标题+状态徽标）或「未关联」/派生状态徽标/操作（关联任务、编辑、归档/恢复、删除二次确认，物理删除）；
  - 新建/编辑抽屉（modal）：标题、说明、年份、月份、关联任务下拉（编辑时当前关联不被过滤掉、已被其他任务占用的计划不可选）；workPlanId 空串 → null（解绑）；
  - 关联任务选择器：可搜索工作列表（客户端过滤 /work-plans?limit=500），已占用目标的行禁用并注明；支持一键「解除关联」；
  - 乐观锁 409 → 表单提示「数据已被修改，请刷新后重试」并刷新查询；其余错误回显服务端 detail（含「该目标已关联其他工作任务」）；
  - 空态、文案按 R9；布局沿用 DESIGN.md（content-page/page-header/settings-panel/field-dialog 复用既有组件类）。
- **WorkPlanDrawer**：新增「月目标」区块（Target 图例；复选框标签 `2026 年 8 月 · 目标标题`；已被其他任务关联的目标禁用；保存提交 `monthlyGoalIds`；服务端错误经 onSave 回显为表单错误）。注意：`useMemo` 必须放在 `if (!open) return null` 之前，否则 hooks 顺序错乱（`opens cleanly after being rendered closed` 测试曾命中此坑）。
- **WorkPlansPage**：新增 `["monthly-goals"]` useQuery；PlanRow 标题格改为 flex 列（按钮 + 目标标签 chips，Link 跳转 /monthly-goals，title 提示完整标签）；`duplicateWorkPlanInput` 保留 `monthlyGoalIds`；保存成功后 invalidate `["monthly-goals"]`（任务侧改关联后目标页同步）。
- **样式**（styles.css）：`.plan-row-title-cell` / `.goal-chip`（深色主题适配）/ `.month-toolbar` / `.goals-table`（含移动端 min-width）/ `.goal-option` / `.goal-link-*` 系列。
- **验证**：web build 通过（MonthlyGoalsPage 懒加载 chunk 正常）；临时冒烟测试（已删）验证列表渲染（关联徽标 ×2、汇总文案）与新建流程 POST 正常；web 全量测试 129/130（唯一失败为 OverviewPage 既有日期腐化，与本次无关）；pnpm -r typecheck 全绿。
- **留给票据 04 的已知点**：WorkPlansPage.test.tsx 的 apiMock 对 `/monthly-goals` 路径会 throw（页面容错通过），04 补 chips 断言时需扩展该 mock；正式组件测试（MonthlyGoalsPage.test.tsx）与抽屉 payload 断言按规格 R8 在 04 落地。