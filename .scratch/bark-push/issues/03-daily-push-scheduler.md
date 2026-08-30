# 03 — 每日 09:30 推送调度（tick 挂载 + 去重 + 终止边界）
Type: task
Status: resolved
Blocked by: 01, 02
Spec: ../spec.md
Scope: apps/server/src/app.ts（scheduler tick 挂载）、apps/server/src/modules/bark-push.ts（新增）、apps/server/test/

## 背景
规格 R3 与决策 D3/D4/D5/D6。复用 reminders 模块推导今天的检修单提醒，叠加推送侧的终止过滤与日志去重；这是本特性核心。

## 改动清单
1. 新模块 `modules/bark-push.ts`：`runDailyBarkPush(deps)`，deps 注入 db、reminders 推导、bark 客户端、now（时区 Asia/Shanghai），便于测试。
2. 逻辑（在 tick 内调用）：
   - 本地时间 < 09:30 → 返回（不推送）。
   - `bark_config` 缺失或 `device_key` 为空 → 返回（功能关闭）。
   - 调 `GET /api/v1/reminders` 同源推导函数取今天 type=`work-order` 的提醒及触发计划。
   - 逐计划过滤：计划 startAt 的**本地日 ≤ 今天** → 跳过（D4 终止线，与开始时刻无关；含开始当天 09:30 仍 pending 的场景）。
   - 查 `bark_push_log`：今天该 (reminder_type, plan_id) 已有记录 → 跳过。
   - 推送（title「检修单提醒」；body = 计划标题 + 「M 月 D 日开始，请及时起检修单」；group=`work-order-reminder`）；成功 → 落一行日志（push_date=今天）；失败 → 记 warning，不落日志（下个 tick 自然重试）。
   - 单计划失败不影响其余计划；整体异常不冒泡出 tick（沿用现有 try/catch 日志模式）。
3. `app.ts`：现有 60s tick 中追加 `runDailyBarkPush` 调用（fail-soft）。
4. 测试（注入 now/假 Bark 客户端）：
   - 09:29 不推、09:30 推；同 tick/多次 tick 不重推（日志去重）。
   - 提醒日当天开始推；开始前一天最后一条；开始当天（含 14:00 开始、09:30 时仍 pending）不推。
   - 手动完成（status override）与取消后不推。
   - Key 为空零调用零报错；Bark 失败后下一 tick 重试、成功后停止；多计划部分失败互不影响。
   - 错过提醒日（今天 > reminderDate）仍每日推。

## 验收
- 上述时间边界与幂等测试全绿；server typecheck/test 通过。
- 手动验收：配置真实 Key 后，将一个 `need_ticket` 计划的开始日改为明天，当天 09:30 后收到推送且仅一条。

## Comments

## Answer

- 新增 `apps/server/src/modules/bark-push.ts`：`runDailyBarkPush(deps)`（deps 注入 db/reminders/now/client/log）。
  - 先判本地时区（Asia/Shanghai）≥ 09:30；config 缺失或 device_key 为空 → 静默返回。
  - 取今天的 work-order 提醒（flatMap 全部分组，非只取第一组）→ D4 过滤「计划开始本地日 ≤ 今天」（与开始时刻无关）→ 逐计划查 `bark_push_log` 去重 → 推送（title「检修单提醒」、body=标题+M 月 D 日开始+提示语、group `work-order-reminder`）→ 成功落日志，失败记 warning 不落日志（下 tick 自然重试），单计划失败不影响其余，整体不冒泡。
- `app.ts` scheduler tick 追加 fail-soft 调用（`.catch` 记 error；runDailyBarkPush 内部已全面 try/catch）。
- 测试：`test/bark-push.test.ts` 8 例（09:29 不推 / 09:30 推、同日重复 tick 不重推、开始前一天推 / 开始当天 14:00 仍 pending 不推、错过提醒日仍推、完成/取消不推、空 Key 零调用零报错、失败重试成功后停止、多计划部分失败互不影响）。
- 验收：server typecheck/test 通过。
