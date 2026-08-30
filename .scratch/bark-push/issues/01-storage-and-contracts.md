# 01 — 服务端存储与契约：bark_config / bark_push_log
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts（Bark 设置/测试推送 schema）、apps/server/src/db/schema.ts、apps/server/src/db/migrate.ts、apps/server/test/

## 背景
规格 R1 与决策 D3/D6。Bark 配置是推送通道的持久化前提；推送日志是对「提醒零存储」的唯一破例（ADR-0005），用于同日同计划的幂等去重。

## 改动清单
1. `apps/server/src/db/schema.ts` 新增两张表：
   - `bark_config`：单行配置表（`id` 固定 1 或以存在行为准），字段 `server_url`（默认 `https://api.day.app`）、`device_key`（可空，空=推送关闭）、`updated_at`。
   - `bark_push_log`：`push_date`（TEXT，YYYY-MM-DD，Asia/Shanghai 本地日）、`reminder_type`（TEXT）、`plan_id`（TEXT）、`pushed_at`；唯一索引 `(push_date, reminder_type, plan_id)`。
2. `migrate.ts` 补对应 `CREATE TABLE` / 索引语句，与现有迁移风格一致（参照 `work_plans_schedule_idx` 模式）。
3. `packages/contracts` 新增：
   - `barkConfigSchema`（server_url、device_key）及 PUT 请求 schema（URL 格式校验）。
   - `barkTestPushResponseSchema`（success、message/detail 摘要）。
4. 单测：迁移可重复执行（幂等）；唯一约束在重复 (date, type, plan) 时冲突；contracts schema 校验（非法 URL 拒绝）。

## 验收
- migration 在空库与现有运行库结构上均可执行；`bark_push_log` 唯一键生效。
- contracts build 通过；server typecheck/test 通过。

## Comments

## Answer

- `apps/server/src/db/schema.ts`：新增 `barkConfig`（单行，`id` 主键固定 1，`server_url` 默认 `https://api.day.app`，`device_key` 可空）与 `barkPushLog`（`push_date`/`reminder_type`/`plan_id`/`pushed_at`，唯一索引 `bark_push_log_unique_idx`）。
- `apps/server/src/db/migrate.ts`：版本 10 `bark_push_support`，含 `CHECK (id = 1)` 单行约束与唯一索引，与现有迁移风格一致。
- `packages/contracts`：新增 `barkServerUrlSchema`（`z.url` + http(s) 协议限制）、`barkDeviceKeySchema`、`barkConfigSchema`、`updateBarkConfigSchema`（strict）、`barkTestPushResponseSchema` 及对应类型（`BarkConfig`/`UpdateBarkConfig`/`BarkTestPushResponse`）。
- 测试：migration 幂等（重复执行不重跑 v10）、单行约束、唯一索引重复 (push_date, reminder_type, plan_id) 冲突；contracts URL 校验（非法/非 http(s) 拒绝、空 Key 接受、未知字段拒绝、超长 Key 拒绝）。
- 验收：contracts build/test、server typecheck 与全部 112 个测试通过（含既有 v4/v5/v8 存量库迁移用例）。
