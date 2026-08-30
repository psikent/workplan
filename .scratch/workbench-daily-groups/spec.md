# Spec: 工作台分组显示（Workbench Daily Groups）

> Status: **已提交** — 票据 01–03 全部 resolved；实现与文档已随提交入库（2026-08-30）。web 245/245、全仓 typecheck 全绿。

## Goal

工作台（OverviewPage）从「今日提醒 + 接下来的工作计划（前 6 条）」改为四个固定顺序的分组，回答"今天该关注什么"：

1. **今日提醒**：当天有小铃铛提醒时逐条展示（每条提醒×计划一行）。
2. **今日新开工**：开始时间是今天的计划。
3. **今日继续开工**：此前开工且今天在工期内的计划。
4. **接下来的计划**：开始日在未来 7 个工作日窗口内的计划。

同时修复移动端顶栏不显示「工作台」导航标签的缺陷。

## Terms

见 `CONTEXT.md`：**Starting Today (今日新开工) / Continuing Today (今日继续开工) / Upcoming Window (接下来的窗口) / Working Day (工作日)**。提醒相关术语沿用 `work-plan-reminders` 规格。

## Background facts

- 「今日提醒」区块已由 `work-plan-reminders` 规格（票据 03）实现：`fetchReminders(today, today)` + `reminderRows` 逐条展示，本规格不改其内容与交互。
- 工作台前端一次性拉取全部计划（`/work-plans?limit=500`，30s 轮询），分组为纯前端派生，**无后端改动**。
- 工作日口径与服务端 `apps/server/src/modules/reminders.ts` 一致：周一至周五、本地日粒度、节假日表为接缝（常量空集）。
- 移动端缺陷：`styles.css` ≤720px 媒体查询中 `.sidebar-nav .nav-item:nth-child(1) { display: none; }` 自基线提交起隐藏了第一项导航（即「工作台」），移动端只能靠 URL 进入工作台。

## Requirements

### R1 分组成员规则（本地日粒度，日期串按 YYYY-MM-DD 字典序比较）

- 活跃计划 = `status ∉ {completed, cancelled}`。
- **今日新开工**：`localDay(startAt) === today`。
- **今日继续开工**：`localDay(startAt) < today && localDay(endAt) >= today`（今天结束仍算继续；与今日新开工不重叠）。
- **接下来的计划**：`today < localDay(startAt) <= windowEnd`，`windowEnd` = 今天之后（不含今天）的第 7 个工作日；按开始日判定，多日计划不限结束日；窗口内周末开工的计划同样计入（窗口是日历区间）。
- 同一计划至多出现在一个分组（今日提醒除外——提醒是独立视角，允许与分组 2/3 并存）。

### R2 排序与上限

- 三个计划分组组内均用仓库统一排序 `compareWorkPlansBySchedule`（开始升序、同开始则工期长在前），不设条数上限。

### R3 空状态

- 任一分组无内容时整个区块隐藏（含今日提醒，维持现状）。
- 四个分组全为空且加载完成时，显示一条整体空态：「今天没有需要关注的工作计划」。

### R4 移动端导航修复

- 删除 ≤720px 下 `.sidebar-nav .nav-item:nth-child(1)` 的隐藏规则，移动端顶栏恢复显示 工作台 / 工作计划 / 月目标 /（管理员的）设置。

### R5 展示

- 三个计划分组的行复用现有 upcoming 行样式：开始日徽标 + 标题 + 起止时间 + StatusBadge + 箭头，链接到时间轴（`workPlanTimelineLink`）。
- 「接下来的计划」头部保留「查看全部 →」链接；页面顶部统计栏不变。

## Out of scope

- 后端/`/api/v1/reminders` 改动；节假日表；分组的已读/消除状态；工作台其它区块（统计栏、今日提醒内容）变更。

## 验收标准

1. 工作台按 今日提醒 → 今日新开工 → 今日继续开工 → 接下来的计划 顺序分组展示；空分组不渲染。
2. 开始日为今天的活跃计划出现在「今日新开工」；此前开工、今天在工期内的出现在「今日继续开工」；两者互斥。
3. 开始日在未来 7 个工作日窗口内的活跃计划出现在「接下来的计划」；窗口外的（更远未来）不出现。
4. 已完成/已取消的计划不出现在任何计划分组。
5. 全部为空时显示整体空态文案。
6. 移动端（≤720px）顶栏可见「工作台」标签。
7. web typecheck 与测试通过；全仓 typecheck 通过。
