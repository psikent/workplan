# 待开发规格：月目标（monthly-goals）

## 目标

每月为工作安排一组**随月份变化**的特定工作目标（月目标）。通过在**工作任务**上打挂「目标标签」，把任务与特定月目标对应起来，并**由关联任务的完成情况自动指示该目标的完成状态**。

用户已确认的建模约束：

- **完成判定**：有关联的工作任务只要被标记为已完成，该月目标即算完成（状态派生，见 R4）。
- **关联约束**：一个月目标只关联**一条**工作任务；一条工作任务可关联**任意多**个月目标。
- **双向维护**：既可在任务编辑抽屉里勾选月目标，也可在月目标配置页反向关联任务，两种途径效果等价。
- **页面与权限**：独立的月目标配置页，**管理员与编辑者都可配置和查看**。

本规格覆盖需求、数据模型、API、界面、测试与验收标准。实现按 .scratch/monthly-goals/issues/ 下的票据分步进行。

## 术语

| 词条 | 含义 | 避免使用 |
| --- | --- | --- |
| 月目标 (Monthly Goal) | 一个属于某年某月的具体工作目标，有标题、说明；至多关联一条工作计划 | 目标标签、里程碑、指标 |
| 目标任务标签 (Task-Goal Tag) | 工作任务上引用某个月目标的标记，即 Work Plan 的 monthlyGoalIds；一条任务可挂多个，一个月目标只接受一个 | 自由标签、备注标签 |
| 目标状态派生 (Derived Goal Status) | 月目标的完成状态由其关联工作计划的**有效状态**算出（尊重手动状态覆盖）；无关联时为「未关联」而非某种状态 | 手动目标状态、目标进度百分比 |
| 目标配置页 (Goal Configuration Page) | 路由 /monthly-goals 的独立页面，管理与查看所有月目标 | 目标工作台 |

同步维护 CONTEXT.md 词条（见票据 01）。

## 背景事实

- 本仓库采用策略：Work Plan（工作计划）是唯一可见工作项；无独立 task/project 容器（CONTEXT.md）。月目标不改变这一模型，目标标签只是 Work Plan 上的一个新的**受约束关联属性**。
- 历史遗留：原 tags / reminders / notifications 服务端能力已被**刻意删除**：apps/server/test/app.test.ts:816 断言 POST /api/v1/work-plans 携带 tags / reminders 时返回 422、GET /api/v1/tags 与 /api/v1/notifications 返回 404。本特性**不得**恢复自由标签或提醒/通知；目标标签是引用月目标 id 的新一等属性。
- 工作计划状态存在自动/手动两种模式（statusMode，packages/contracts/src/index.ts 的 workPlanStatusSchema）：手动覆盖优先于自动派生（deriveWorkPlanStatus 按 startAt/endAt 推导）。目标状态派生必须复用这一语义。
- 服务端为 Fastify + better-sqlite3（apps/server/src/db/index.ts 已启用 PRAGMA foreign_keys = ON）；表结构迁移集中在 apps/server/src/db/migrate.ts（当前最高版本 6）。
- REST 鉴权：路由默认允许任何已登录用户；管理专属通过 route config authorization: admin 标记（apps/server/src/app.ts:162）。月目标面向管理员+编辑者，故**不加** admin 限制。
- Web 导航与路由：apps/web/src/components/AppShell.tsx 的 navItems（adminOnly 控制可见性）、apps/web/src/App.tsx 的 Routes（admin 页面用角色守卫重定向）。
- 导出/导入：TransferService（apps/server/src/modules/transfer.ts）按 schemaVersion 1/2 导出**原始表转储**；v2 起含 owner_account_mappings；现有测试断言导出 schemaVersion 为 2（apps/server/test/app.test.ts:855）。新增表需要升级到 **schemaVersion 3**，并保持 v1/v2 文件可导入。
- Web 测试以 vi.mock 拦截 ../lib/api 的 api 函数（见 apps/web/src/pages/WorkPlansPage.test.tsx）；Work Plan fixture 散落在 5 个测试文件中（WorkPlansPage.test.tsx、WorkPlanDrawer.test.tsx、GanttTimeline.test.tsx、GanttTimeline.render.test.tsx、OverviewPage.test.tsx），Work Plan 类型新增字段后需同步补齐这些 fixture。

## 需求

### R1 数据模型（迁移 #7）

新增表 monthly_goals：

    CREATE TABLE monthly_goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,             -- 1-12
      work_plan_id TEXT REFERENCES work_plans(id) ON DELETE SET NULL,
      archived_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX monthly_goals_period_idx ON monthly_goals(year, month);
    CREATE INDEX monthly_goals_work_plan_idx ON monthly_goals(work_plan_id);

- work_plan_id 单列 + 可空即天然满足「一个月目标至多一条任务」；删除任务时关联自动置空（SET NULL）。
- archived_at 提供软归档（同 Custom Field 的归档语义），保留历史；已归档目标默认从列表隐藏，但保留其关联供查看。
- 同步在 apps/server/src/db/schema.ts 用 drizzle sqliteTable 增加 monthlyGoals 定义（含索引），与迁移保持一致。

### R2 契约（packages/contracts/src/index.ts）

- monthlyGoalSchema（响应 DTO）：
  - 基础字段：id、title、description、year、month、archivedAt（可空）、version、createdAt、updatedAt；
  - 派生字段：status: WorkPlanStatus | null（null 表示未关联）、linkedWorkPlan: { id: string; title: string } | null。
- createMonthlyGoalSchema：title（1-200）、description（默认空串，<=2000）、year（2000-2100 整数）、month（1-12 整数）、workPlanId（uuid，可空，默认 null），strict 模式。
- updateMonthlyGoalSchema：createMonthlyGoalSchema.partial() + { version }，其中 workPlanId 三态语义：**缺省=不变、uuid=重新关联（校验目标存在）、null=解绑**。
- Work Plan 契约：workPlanSchema 增加 monthlyGoalIds: z.array(z.string().uuid()).default([])；workPlanValuesSchema 增加可选的 monthlyGoalIds（创建缺省 []，更新缺省表示保持不变，提供则**整体替换**）。导出类型同步（WorkPlan、CreateWorkPlan、UpdateWorkPlan）。
- 注意 workPlanValuesSchema 被周期模板（series template）复用：模板 JSON 需可承载 monthlyGoalIds，周期生成的每次发生（Occurrence）都继承同一组目标标签。

### R3 服务与 API

**新模块** apps/server/src/modules/monthly-goals.ts（MonthlyGoalService）：

- list({ year?, month?, includeArchived? })：按月/年过滤（缺省全部非归档），排序 year desc, month desc, created_at asc；批量计算派生状态与关联任务信息。
- get(id)、create(input)、update(id, input)（乐观锁 version，冲突抛 VERSION_CONFLICT）、delete(id, version)（物理删除）。
- 关联维护（供 WorkPlanService 复用）：setTaskLinks(workPlanId, goalIds)（整体替换：解绑不在列表中的、绑定新增的，事务内执行）、getGoalIdsByWorkPlan(workPlanId)、validateGoalIds(goalIds)（目标不存在时报 VALIDATION_ERROR）。
- 校验规则：关联的 workPlanId 必须存在（否则 422）；已归档目标可以被引用（归档只影响列表可见性）。

**新路由** apps/server/src/routes/monthly-goals.ts（registerMonthlyGoalRoutes）：

- GET /api/v1/monthly-goals（year?、month?、includeArchived?）
- GET /api/v1/monthly-goals/:id
- POST /api/v1/monthly-goals（201）
- PATCH /api/v1/monthly-goals/:id
- DELETE /api/v1/monthly-goals/:id?version=（204）

**接线**：apps/server/src/app.ts 构造 MonthlyGoalService，注入 WorkPlanService 构造参数，并注册新路由。依赖方向：monthly-goals 直接读表，不依赖 WorkPlanService，无循环依赖。

**WorkPlanService 集成**（apps/server/src/modules/work-plans.ts）：

- serialize 增加 monthlyGoalIds（该任务的关联目标 id 列表）；列表/搜索批量预取避免 N+1。
- createInternal：事务内插入 Work Plan 后设置关联；update：提供 monthlyGoalIds 时整体替换。
- 复制任务（duplicateWorkPlanInput）保留 monthlyGoalIds。

### R4 目标状态派生

| 关联任务 | 目标状态 |
| --- | --- |
| 无关联任务 | status: null，界面显示「未关联」 |
| 任务 manual | 任务 status（尊重手动覆盖，含 cancelled 已取消） |
| 任务 automatic | deriveWorkPlanStatus(startAt, endAt, now)（未开始/进行中/已完成） |

派生为只读计算，不落库，随任务状态实时变化。

### R5 目标配置页面（Web）

- 导航项「月目标」：AppShell navItems 新增 { to: /monthly-goals, label: 月目标, icon: 图标, adminOnly: false }（管理员与编辑者均可见）；App.tsx 新增路由 /monthly-goals -> MonthlyGoalsPage（**无** admin 重定向守卫，与 /work-plans 一致）。
- 新页面 apps/web/src/pages/MonthlyGoalsPage.tsx：
  - **月份选择**：年份 + 月份选择器，默认当前月；可切换查看任意月份。
  - **目标列表**：每行显示标题、说明、所属月份、关联任务（标题 + 状态徽标）或「未关联」、派生状态徽标、操作按钮（编辑 / 归档 / 恢复 / 删除 / 关联任务）。
  - **月度汇总**：本月已完成 X / Y 个目标（进度以完成数与总数为准）。
  - **新建 / 编辑抽屉**：标题、说明、年份、月份、可选「关联任务」（工作计划下拉选择）；乐观锁冲突（409）时提示刷新重试；编辑时允许解绑任务（workPlanId: null）。
  - **关联任务**：目标行内「关联任务」入口弹出工作计划选择器（可搜索），与任务抽屉勾选等效；若该目标已有关联任务则先解绑再改绑（同一次保存内完成）。
  - **归档/恢复**：归档后默认列表隐藏，可切换「显示已归档」恢复；**删除**需二次确认，物理删除。
- 页面布局遵循 docs/design/DESIGN.md：真白画布 #f6f8fb、近黑 Navy #13213c、强调色 #3157df、状态用绿/琥珀/珊瑚/石板色、单像素边框、紧凑工具栏、28px 页标题。

### R6 任务侧集成

- WorkPlanDrawer 增加「月目标」区块：多选列表（列出全部非归档月目标，标签为「2026 年 3 月 · 目标标题」），创建/编辑保存时提交 monthlyGoalIds。
- 保存失败时把服务端错误（含「该目标已关联其他工作任务」类提示）回显为表单错误。
- 工作计划列表行（PlanRow）显示目标标签 chips（小型，标题短截 + title 提示），点击可跳转月目标页。

### R7 导出/导入（TransferService -> schemaVersion 3）

- version3BusinessTables = 版本 2 表 + monthly_goals；deleteOrder 增加 monthly_goals（放在最前，先删全表再重建）。
- ExportPayload、assertShape、importCounts 支持版本 3；纯 v1/v2 文件导入时 monthly_goals 结果为空（老文件无此表，不报错）。
- 契约 importPayloadSchema 的 schemaVersion 联合类型允许 3。
- 更新既有断言：apps/server/test/app.test.ts:855 的 expect(version2.schemaVersion).toBe(2) 调整为接受 3；「removes tag...」测试（:816）继续断言导出**不含** tags 键（monthly_goals 是独立表，不冲突）。

### R8 测试

- 服务端 apps/server/test/monthly-goals.test.ts（新建，复用 createContext 模式；可用 fake timers 控制派生状态）：
  - CRUD 与乐观锁（VERSION_CONFLICT）、归档/恢复、删除。
  - 派生状态：无关联->null；automatic 任务按时间推导（pending/in_progress/completed）；manual 任务含 cancelled。
  - 任务侧：创建携带 monthlyGoalIds、更新整体替换、解绑；目标已被其他任务关联时给出明确 422。
  - 权限：editor（token 与 password 两种）均可增删改查月目标（对照 app.test.ts:475 的 editor 用例写法）。
  - 传输：导出 schemaVersion 3 且含 monthly_goals 数据；v1/v2 文件导入兼容。
  - 回归：既有 not.toHaveProperty("tags") 断言保持通过。
- Web：
  - apps/web/src/pages/MonthlyGoalsPage.test.tsx：渲染月份列表、月份切换、新建/编辑/归档/恢复、关联/解绑任务、月度汇总文案。
  - WorkPlanDrawer.test.tsx：目标多选渲染与提交 payload 断言。
  - 同步修正 5 处 Work Plan fixture（补 monthlyGoalIds: []）。

### R9 UI 文案（中文，与全站一致）

- 月目标 / 目标名称 / 所属月份 / 说明 / 状态（未开始、进行中、已完成、已取消、未关联）
- 关联任务 / 解除关联 / 关联失败：该目标已关联其他工作任务
- 本月已完成 {completed} / {total} 个目标
- 新建月目标 / 编辑月目标 / 归档 / 恢复 / 删除（删除确认文案：删除后该月目标将从所有任务标签中消失）
- 空态：这个月还没有配置月目标
- 乐观锁冲突：数据已被修改，请刷新后重试

## 验收标准

1. 月目标配置页可按月增删改查，完成状态随关联任务实时派生且尊重手动状态。
2. 一条任务可勾选多个月目标；一个月目标可反向关联/解绑唯一任务；占用冲突给出明确错误。
3. 管理员与编辑者都能进入 /monthly-goals 并配置。
4. JSON 导出为 schemaVersion 3 且含 monthly_goals；v1/v2 文件导入不报错。
5. 全部既有测试通过（含「tags 已被移除」断言），新增测试覆盖 R8 各项。
6. pnpm typecheck 与 pnpm test（contracts -> server -> web -> 脚本）全绿。

## 范围外（Out of scope）

- 与月目标无关的自由标签、提醒、通知（延续「删除 tag/reminder/notification API」的既有决策）。
- 一个月目标关联多条任务、目标权重/百分比、目标逾期或历史报表、目标 XLS 导出、目标可见性的账号级细分。
- 月目标自动生成（如每月 1 日按模板创建）；备注/协作评论。