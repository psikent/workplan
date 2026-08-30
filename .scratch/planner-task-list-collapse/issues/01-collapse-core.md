# 01 — 任务列收起核心：状态模型 + 切换按钮 + 收起布局
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src

## 背景

规格 R1–R5。工作计划页甘特视图增加「收起左侧任务列表」能力：切换按钮、收起态布局、状态持久化、移动端自动收起、滚动同步容错。

## 改动清单

1. `apps/web/src/pages/WorkPlansPage.tsx`：
   - 新增 `collapsed` 状态 + `matchMedia("(max-width: 720px)")` 探测（监听断点变化，跨断点按规格 R3 重算默认值）。
   - localStorage `workplan:planner-collapsed:v1`（load/save helper 沿用现有版本化 + try/catch 模式）；手机端切换不写盘。
   - `.table-toolbar` 第 1 列渲染收起按钮（`grid-column: 1; justify-self: start`，样式对齐现有 icon-button）。
   - `.planner-panel` 追加 `planner-collapsed` 修饰类；时间轴区左上角条件渲染收起条（展开按钮 + 周/月标题，复用工具条同款文案表达式）。
2. `apps/web/src/styles.css`：
   - `.planner-collapsed`：左栏与分隔条归零隐藏，时间轴占满全宽。
   - 收起条 absolute 定位样式，与 range controls / 视图切换 / 甘特条属性不重叠（必要时收起态下 range controls 让位）。
   - ≤720px 下收起条与按钮的窄屏适配。
3. `apps/web/src/components/GanttTimeline.tsx`：`synchronizeVerticalScroll` 对缺失/隐藏 peer 容错（peer ref 为空或高度为 0 时跳过）。

## 验收

- 规格验收标准 1、2、5、6 手动过；3、4 由票据 02 单测覆盖；`corepack pnpm --filter @workplan/web typecheck` 通过。

## Comments

2026-08-31（实现备注）：

- 收起态布局最终采用「工具条整行保留」方案：`planner-collapsed` 下 `.planner-table` 只留 54px 工具条行（展开按钮 + 周标题），时间轴占第 2 行满宽 —— 与 R2 收起条语义一致（按钮在时间轴左上角），且天然不与 range controls / 视图切换 / 甘特条属性重叠，无需让位规则。
- 滚动同步容错未用 offsetWidth 启发式（jsdom 无布局会误伤），改为显式 prop：WorkPlansPage 传 `taskListCollapsed` 给 GanttTimeline，收起时跳过滚动/悬停同步挂接，随图表重建自动恢复。
- 验收 1、2、5、6 已浏览器实测（桌面 1280px + 手机 390px，见票据 02 记录）；web typecheck 通过。
