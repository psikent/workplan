# 服务端系列模型、生成与 API（server）
Type: task
Status: resolved
Blocked by: 05

## 背景
规格 R10 数据模型/契约/传输。落地 monthly_goal_series 表、生成逻辑、路由与 transfer v4。
## 改动清单
1. apps/server/src/db/schema.ts：新增 monthlyGoalSeries 定义；monthlyGoals 增加 seriesId/occurrenceKey 与唯一索引。
2. apps/server/src/db/migrate.ts：迁移 #8（monthly_goal_series 建表 + ALTER monthly_goals，SQL 见规格 R10）。
3. 新建 apps/server/src/modules/monthly-goal-series.ts：MonthlyGoalSeriesService（create 生成全部实例 / list / get 含实例摘要 / update 补齐缺失期 / stop 置 active=0；频率步长 monthly/quarterly/yearly × interval；count 与 until 相交取先到；无界拒绝；600 上限）。
4. 新建 apps/server/src/routes/monthly-goal-series.ts：GET 列表 / GET :id / POST（201）/ PATCH :id / DELETE :id?version=（204），无 admin 限制。
5. apps/server/src/app.ts：装配 MonthlyGoalSeriesService 并注册路由。
6. apps/server/src/modules/monthly-goals.ts：serialize 增加 seriesId/occurrenceKey；行字段直接带出。
7. apps/server/src/modules/transfer.ts：schemaVersion 升 4；version4BusinessTables 加 monthly_goal_series；deleteOrder 先删 monthly_goals 再删 monthly_goal_series；INSERT 顺序 series 先于 goals；v1/v2/v3 导入兼容。
8. 更新 apps/server/test/app.test.ts 与 migrate.test.ts 的版本断言（4 / 8）。
## 验收
- 创建系列立即生成全部期数实例（正确性：步长、count/until 相交、无界 422、600 上限 422）。
- 实例独立：编辑/归档/删除实例不影响系列；PATCH 规则后补齐缺失期、不删已生成实例；停止后不再生成。
- 编辑者（token 与 password）可访问全部系列路由；管理员无额外限制。
- 导出 schemaVersion 4 含 monthly_goal_series；导入 v1/v2/v3 文件不报错且 series 清空、goals 保留。

## Comments

### 2026-08-22 实现摘要

- **迁移 #8**（migrate.ts）：monthly_goal_series 建表（template_json/frequency/interval/start_year/start_month/occurrence_count/until_year/until_month/active/version/时间戳）；monthly_goals 加 `series_id`（REFERENCES monthly_goal_series ON DELETE SET NULL）与 `occurrence_key`；唯一索引 `monthly_goal_series_occurrence_idx(series_id, occurrence_key)`（SQLite NULL 不参与唯一性，非系列行不受约束）。drizzle schema 同步（新增 monthlyGoalSeries 表、monthlyGoals 加列与索引）。
- **MonthlyGoalSeriesService**（新模块 monthly-goal-series.ts）：
  - 周期数学：periodKey = year*12+month-1；步长 monthly=+interval、quarterly=+3×interval、yearly=+12×interval；结束取 count 与 until（含该期）先到者；至少一个结束条件否则 422「必须指定期数或结束月份之一」；单次生成超 600 期 422。
  - create：INSERT 系列行 → insertMissingPeriods 生成全部期数实例（模板 title/description、work_plan_id NULL、archived NULL、series_id+occurrence_key 如 `2026-08`），返回 `{ series, generated: MonthlyGoal[] }`。
  - list：实例数按 series_id GROUP BY 批量取（避免 N+1）；get：含 instances 摘要（id/title/year/month/archivedAt，按年/月排序）。
  - update（乐观锁 version）：合并三态（缺省=不变/提供=替换）；校验合并后的结束条件；已生成实例保留，仅补齐缺失期；**active=0（已停止）的系列只改规则不再生成**（generated 恒 []）。
  - stop(id, version)：active 置 0 + version+1；错版 409（与月目标 delete 同款 exists 判定）。
- **路由**（routes/monthly-goal-series.ts）：GET 列表 / GET :id / POST（201）/ PATCH / DELETE :id?version=（204），无 admin 限制；app.ts 装配（MonthlyGoalSeriesService 注入 MonthlyGoalService 用于 generated 序列化）。
- **monthly-goals.ts**：row 类型与 serialize 增加 seriesId/occurrenceKey（SELECT * 直接带出，无额外查询）。
- **TransferService v4**：version4BusinessTables = v2 表 + **monthly_goal_series + monthly_goals**（INSERT 顺序 series 先于 goals 满足 FK）；deleteOrder 先删 monthly_goals 再删 monthly_goal_series 再其余；ExportPayload schemaVersion 4；assertShape 版本白名单改 `[1,2,3,4]`（**漏改导致的 422 已修复**——这是初期 2 个既有用例失败根因）；replace() 对 <4 版本的 monthly_goals 行剥离 series_id/occurrence_key（真实 v3 文件不携带该列；防御性归一）。
- **测试断言更新**：migrate.test.ts 两处 MAX(version) 7→8；app.test.ts 「round-trips owner mappings」断言 schemaVersion 4、v1 载荷同时剥掉 monthly_goal_series；monthly-goals.test.ts 传输用例升 4 并增加 v3 兼容导入断言（series 清空、goals 去系列化保留）。
- **验证**：monthly-goals.test.ts 15/15；server 全量 75/75。
