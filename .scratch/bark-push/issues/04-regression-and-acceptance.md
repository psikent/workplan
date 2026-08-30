# 04 — 回归与验收
Type: task
Status: resolved
Blocked by: 02, 03
Spec: ../spec.md
Scope: apps/server/test/、apps/web/src/（必要时）、全仓 typecheck/test

## 背景
规格 R4。特性收尾：确认未破坏既有约束，验收标准逐条核对。

## 改动清单
1. legacy 回归确认：`/api/v1/notifications`、`/api/v1/tags` 仍 404；`tags`/`reminders` 属性仍 422（app.test.ts 既有断言保持通过）。
2. 环境配置包回归：export/import 测试不含 Bark 配置字段。
3. 全仓 `pnpm typecheck` 与 `pnpm test` 通过（多跑两轮确认无 flake）。
4. 对照 spec「验收标准」1–6 逐条核对，结果记入本票 Comments。
5. 更新 spec 顶部 Status 为已提交，并在 README 的功能清单（如有）补一行 Bark 推送说明。

## 验收
- 验收标准 1–6 全部满足；回归全绿。

## Comments

## Comments

### 验收标准逐条核对（2026-08-30）

1. **每日 09:30 推送，文案含标题与开始日期** — `bark-push.test.ts`：09:29 不推 / 09:30 推；body 含计划标题与「N 月 N 日开始」；错过提醒日（derivedReminderDate < today）仍推 ✅
2. **开始当天起停止；完成/取消立即停止** — 开始日=明天可推、开始日=今天 14:00（09:30 仍 pending）不推；已完成/已取消计划不推 ✅
3. **同日同计划只推一条** — 同一 tick 连续三次运行仅 1 次客户端调用、日志 1 行；`bark_push_log` 唯一索引（票据 01 测试）机制兜底 ✅
4. **Key 留空零推送零报错；测试推送验证连通** — 空 Key/无行均零调用零 error 日志；`POST /settings/bark/test` 成功与失败分支（stub fetch 断言 URL/query）✅
5. **非 Administrator 拒绝；环境配置包不含 Bark** — editor 对 GET/PUT/test 全部 403；`GET /env-config` 输出无 bark/deviceKey 字段断言 ✅
6. **R4 回归** — `removes tag, reminder and notification APIs`（404/422）通过；全仓 typecheck/test 通过（contracts 9、server 127、web 215、scripts 50、env-config-export 1）✅

## Answer

- legacy 回归、env-config 包断言、全仓 typecheck/test 确认无回归；spec.md Status 更新为「已交付」，README 功能概述补 Bark 推送一句。
- 手动验收（真实设备 Key 推送）未执行，需部署后用真实 Bark 设备验证。
