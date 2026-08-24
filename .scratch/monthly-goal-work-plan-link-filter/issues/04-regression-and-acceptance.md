# 04 — 文案、回归测试与整体验收
Type: task
Status: resolved
Blocked by: 02, 03
Spec: ../spec.md
Scope: apps/web/src/pages/MonthlyGoalsPage.test.tsx、apps/web/src/components/WorkPlanDrawer.test.tsx、apps/server/src/modules/monthly-goals.ts、apps/server/test/monthly-goals.test.ts

## 背景

规格 R1/R6。候选过滤同时影响双向关联、日期边界和表单状态，需要自动化覆盖历史越界数据与即时清理行为，并完成运行时关联文案核查。

## 改动清单

1. 扩展 `MonthlyGoalsPage.test.tsx`：
   - 新建、编辑、快捷弹窗的同月/跨月过滤；
   - 搜索只作用于已过滤候选；
   - 改年份或月份后立即清理越界关联，仍重叠关联保持；
   - 初次打开历史越界关联时保留，修改标题等非日期字段不解绑；
   - 历史提示、空状态和全部“关联计划”可访问名称。
2. 扩展 `WorkPlanDrawer.test.tsx`：
   - 单月、跨月和跨年候选；
   - 改有效日期立即移除越界目标；
   - 暂时无效日期不清理；
   - 历史越界目标初次打开保留；
   - 保存载荷只包含清理后的 `monthlyGoalIds`；
   - 无候选空状态与“其他工作计划”冲突提示。
3. 将服务端占用冲突文案改为“月目标「…」已关联其他工作计划”，同步调整相关服务端断言；不修改错误代码、状态码和详情对象。
4. 使用 `rg` 核查运行时代码、活动测试和 `CONTEXT.md` 中月目标关联语境的“关联任务”“工作任务”“Task-Goal Tag”；不重写已解决票据的历史记录。
5. 运行专项测试后执行 Web/Server 全量验证与差异检查。

## 验收

- 规格 R1-R6 的正向、边界和历史数据场景均有自动化测试。
- 运行时月目标关联文案全部使用“计划”。
- API 与共享类型无结构变化。
- 以下命令全部通过：
  - `corepack pnpm --filter @workplan/web test`
  - `corepack pnpm --filter @workplan/web typecheck`
  - `corepack pnpm --filter @workplan/web build`
  - `corepack pnpm --filter @workplan/server test`
  - `git diff --check`

## Answer

- 月目标新建、编辑和快捷关联入口，以及工作计划抽屉的单月、跨月、跨年候选过滤、搜索、日期清理、历史越界保留、空状态和可访问文案均已有自动化回归覆盖。
- 服务端占用冲突文案已改为“月目标「…」已关联其他工作计划”，422 状态、错误代码、详情字段和共享类型保持不变。
- 运行时与活动测试已无月目标关联语境的“关联任务”“工作任务”；`CONTEXT.md` 仅在禁用术语中保留 `Task-Goal Tag`。
- Web 171 项测试、Server 75 项测试、Web 类型检查与生产构建、仓库完整测试套件及 `git diff --check` 全部通过；规范与规格双轴审查均无发现。

## Comments

- 本票只收口文案与回归，不扩大到归档、重复系列、导入导出或 API 一致性校验。
