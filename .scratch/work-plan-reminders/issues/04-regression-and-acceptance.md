# 04 — 回归与验收（legacy 保持 + 全仓绿）
Type: task
Status: ready-for-agent
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
