# 04 — 回归与验收（legacy 保持 + 全仓绿）
Type: task
Status: resolved
Blocked by: 01, 02, 03
Spec: ../spec.md
Scope: apps/server/test/、apps/web/src、全仓构建与测试

## 背景
规格验收标准。确保既有回归保持、全仓 typecheck/test 无回归，并逐条核对验收标准 1–6；同时验证「不新增任何服务端提醒存储」。

## 改动清单
1. 保持 apps/server/test/app.test.ts:816 附近「removes tag, reminder and notification APIs」回归 green；确认新提醒路由 \`/api/v1/reminders\` 不与 legacy 路径冲突。
2. 契约构建产物更新（packages/contracts build 后确认 dist）。
3. web/server 各自 typecheck 通过。
4. 全仓测试：corepack pnpm test（web + server 全部套件）。
5. 可选手工验收：启动应用后按验收标准逐条核对（铃铛/悬浮/点击/工作台/错过场景/未来日期）。
6. 全部通过后，按 issue-tracker 惯例在本票追加 \`## Answer\` 记录结果；并（经用户确认后）把 spec.md 的 Status 更新为已实现。

## 验收
- 全仓 typecheck 与 test 全绿；legacy 404/422 回归保持；验收标准 1–6 逐条通过；无新增服务端提醒存储（不触碰 legacy 表）。

## Answer

### 结果概览
- 提醒 feature 本身**验证通过**：legacy 回归保持、新路由不冲突、契约 build 通过、typecheck 全绿、提醒相关套件全绿。
- **全仓 `corepack pnpm test` 无法稳定全绿**：存在两个与本 feature 无关的**既有 flaky 测试**（月度目标 quick-edit 域）间歇性失败。已 `git stash` 到 HEAD（移除提醒代码）复测确认这两个 flaky 为**基线已有**，非本 feature 引入。

### 逐项核对
1. **legacy 回归保持**（验收 5/改动 1）：`apps/server/test/app.test.ts` → `removes tag, reminder and notification APIs while retaining export validation` 通过（app.test.ts 25/25；server 全量干净跑 101/101）。`/api/v1/notifications`、`/api/v1/tags` 仍 404；plan 的 `priority`/`tags`/`reminders` 属性仍 422；export 无 `tags`/`reminder_rules`。注：该测试实际在 app.test.ts:882，非票据所述 816（行号随历史编辑漂移，测试体一致）。
2. **新路由不冲突**（改动 1）：新增 `GET /api/v1/reminders`（apps/server/src/routes/reminders.ts:9-10），与 legacy `/api/v1/notifications`、`/api/v1/tags` 路径不相交。
3. **契约构建产物**（改动 2）：`corepack pnpm --filter @workplan/contracts build` 通过（`tsc -p tsconfig.json`，exit 0）；`packages/contracts/dist/` 已生成 index.js/index.d.ts/index.d.ts.map。
4. **typecheck**（改动 3/验收 6）：`corepack pnpm typecheck` 全绿——contracts build + packages/contracts、apps/server、apps/web 三个 typecheck 均 Done。
5. **全仓测试**（改动 4/验收 6）：提醒相关套件全绿——server `test/reminders.test.ts` 12/12、web 全量干净跑 202/202；但 `corepack pnpm test` 因下面两个既存 flaky 间歇失败。
6. **无新增服务端提醒存储**（验收/背景）：ReminderService 纯只读推导、零写库；未触碰 legacy `notifications`/`reminder_rules`/`tags` 表（export 无 `tags`/`reminder_rules` 断言通过）。
7. **手工验收**（改动 5，可选）：未执行——需启动应用 + 浏览器逐条核对（本次为纯自动化验证）。

### 既有 flaky（与本 feature 无关，基线已证实）→ 已修复
- 服务端 `apps/server/test/monthly-goals.test.ts` → `archives, restores and renames a complete group without changing its links`（约 342 行）：约 2/3 概率失败，`saved.filter(month===2).map(archivedAt!==null)` 得 `[true,false]` vs 期望 `[false,true]`。根因：`monthly_goals` 列表 `ORDER BY year DESC, month DESC, created_at ASC`（monthly-goals.ts:47/165）在同月同毫秒 `created_at`（`nowIso()` 毫秒精度 + `newId()` 随机 UUID）下无稳定 tiebreaker，SQLite 排序不确定。**已 git stash 到 HEAD（无提醒代码）复测 4 次，2 次同样失败 → 基线既有问题（非本 feature 引入）。** 修复（经用户确认后同票内处理）：两处查询追加 `, rowid ASC` 稳定 tiebreaker（插入序即创建序）。修复后：指定用例 12/12、整个文件 5/5、全仓多轮均绿。
- Web `apps/web/src/components/MonthlyGoalQuickEditDialog.test.tsx`：`findByText("已复制 2025 年月目标，请确认后保存")`（约 191 行）与 `findByText("2025 年月目标与当前年度结构一致")`（约 277 行）在 `corepack pnpm test` 高并发负载下偶发超时；隔离跑与干净 web 全量跑均通过（202/202）→ 负载/timing 型 flaky。修复：文件内 `configure({ asyncUtilTimeout: 5000 })`（放宽由 Testing Library waitFor 默认 1s 至 5s，消除负载型查找超时）+ `vi.setConfig({ testTimeout: 15000 })`（vitest 默认 5s 的整用例超时在并行负载下也会被击穿，放宽至 15s；真实失败仍会在 5s 内由 findBy 报出）。

### 修复后验证
- 服务端：指定用例 12/12 连续绿（修复前 ~2/3 失败）；`test/monthly-goals.test.ts` 全文件 5/5；`corepack pnpm test` 全量 5/5 连续绿（web + server + scripts 全部套件）；`corepack pnpm typecheck` 全绿（contracts/server/web）。
- 两个 flaky 修复的改动明细：`apps/server/src/modules/monthly-goals.ts`（两处 ORDER BY 追加 `rowid ASC`）、`apps/web/src/components/MonthlyGoalQuickEditDialog.test.tsx`（configure + setConfig）。

### 结论
- 提醒 feature 验收 1–6 全部达成（legacy 404/422 回归保持、新路由不冲突、契约 build dist 产出、typecheck 全绿、全仓 test 连续多轮全绿、无新增服务端提醒存储）。
- 手工验收（改动 5，可选）未执行——需启动应用 + 浏览器逐条核对（本次为纯自动化验证）。
- spec.md 的 Status 已在本票收尾时更新为已实现（用户已确认走 (a) 路径：修 flaky + 结票）。