# 20 — 自定义字段 JOIN 排序 p95 达标（≤500ms）

Type: task
Status: done
Blocked by: 无 — 可立即开工
Spec: ../spec.md
Scope: work-plan-query 引擎自定义字段排序执行计划、索引/预计算方案、perf-benchmark

## Background

票据 15 起的已知偏差：自定义字段（短文本/数字/单选）排序需要按（字段, 计划）JOIN 取值后 ORDER BY，落入临时 B-TREE；十万行标准数据集上三类用例首页/次页 p95 实测 562–901ms，超出规格 500ms 预算（其余用例全部达标）。本票要求把这三类用例实测带回预算内；规格禁止以扩大超时或降低断言换取达标。

## Work

1. 方案原型与取舍（以 EXPLAIN + 基准数据决策），候选方向包括但不限于：
   - 预计算/物化每字段排序键行集（field_id, plan_id, sort_key）并建覆盖索引，避免排序阶段回表；
   - 按排序级别改写查询策略（如先取字段有序集再回联主表）；
   - 复用 v11 排序键列的针对性复合索引。
2. 落地所选方案，排序语义与现状完全一致：缺失值/空白置后、单选按选项管理顺序（ADR-0009）、文本走中文自然序键、排期顺序兜底。
3. 游标兼容：如排序执行计划变化影响键集游标，走游标版本隔离升级，不破坏在途游标语义。
4. perf-benchmark 三个 JOIN 用例（短文本/数字/单选，首页与次页）复测达标并记录证据。

## Acceptance

- [x] 自定义短文本/数字/单选排序：首页与次页 p95 ≤500ms、p99 ≤1000ms（十万行标准数据集，基准证据入票）。
- [x] 排序语义回归全绿：排序键金样、缺失值置后、单选选项序、准确总数与游标对账。
- [x] 无其他用例回退：排期/标题/状态/时长/五级混合保持达标，工作台与并发预算不变。
- [x] 若穷尽合理方案仍不可达：带完整基准数据与方案证据提交预算改判决策，不静默放宽。（不需要——达标）

## Comments

### 2026-09-07 执行完成：物化排序索引快路径，三类用例 p95 从 562–1393ms 降至 2.0–3.7ms

**方案取舍**（原型验证见 `../prototype/sort-index-proto.mjs`，以 EXPLAIN 决策）：

- 根因：自定义排序键（custom_field_values）与排期兜底链尾列（work_plans.start_at/end_at/created_at/id）分属两表，ORDER BY 无法由任何单表索引满足，SQLite 只能对十万行 JOIN 结果建 TEMP B-TREE。
- 采用票据候选方向一（预计算/物化每字段排序键行集 + 覆盖索引）：新增 `custom_field_sort_index` 表（field_id, work_plan_id, skey, 排期链尾三列），skey 按字段类型取 NULLIF(text_sort_key,'')/number_value/boolean_value/date_value/datetime_sort_key/选项 sort_order（ADR-0009，含归档选项），与引擎 `customSortLevel` 语义逐列对齐。
- **稀疏设计**：只存键非空行（避免 计划×字段 级稠密膨胀），缺失/空白/失效选项的空值区由查询侧用"无索引行"反连接 work_plans 按排期链补齐（idx_work_plans_schedule_full，同样免排序）。
- 两条覆盖索引与两个方向一一对应：`(field_id, skey, start_at, end_at DESC, created_at, work_plan_id)` 与 skey DESC 变体；ORDER BY 与索引逐列匹配 → 覆盖索引顺序扫描 + LIMIT 提前终止，无 TEMP B-TREE。
- 一致性由 7 个触发器维护（值行增删改、计划改期、选项增删与重排），覆盖应用层、JSON 恢复、SQL 回填、级联删除全部写入路径；批量装载（v14 迁移回填、JSON 恢复、基准建库）挂起触发器后集合式重建一次（`withSortIndexBulkLoad`）。
- 快路径仅命中"单一自定义字段排序"形状（加排期链共 5 键位）；多级排序与五级混合等形状维持原 JOIN 路径。键位与旧路径一一对应（k0=排序键、k1..k3=排期链、k4=id），**游标两路径互通，无需版本隔离升级**。
- 迁移 v14 `custom_field_sort_index`：建表 + 索引 + 触发器 + 存量集合式回填。

**基准证据**（2026-09-07T13:42Z，darwin/arm64 开发机，Node v24.18.0 / better-sqlite3 12.11.1 / SQLite 3.53.2，十万行标准数据集 + 50 字段，完整报告 `../perf-report.md`）：

| 用例 | 改造前首页 p95 | 改造后首页 p95 | 改造前次页 p95 | 改造后次页 p95 | 预算 |
| --- | --- | --- | --- | --- | --- |
| 自定义短文本 | 375.8ms | **2.9ms** | 562.9ms ❌ | **2.0ms** | 500ms ✅ |
| 自定义数字 | 223.9ms | **2.0ms** | 647.0ms ❌ | **2.4ms** | 500ms ✅ |
| 自定义单选（双 JOIN） | 1292.8ms ❌ | **3.7ms** | 900.7ms ❌ | **2.4ms** | 500ms ✅ |

p99 全部 ≤3.9ms（预算 1000ms）。EXPLAIN QUERY PLAN 实际执行确认三用例 `SEARCH csi USING COVERING INDEX idx_custom_sort_index_asc/desc (field_id=?)`，无 TEMP B-TREE。审查修正（offset 模式回落 JOIN 路径）后的最终轮复测（15:12Z）同为 2.8 / 3.0 / 2.8ms 首页 p95，全部达标；以 `../perf-report.md` 最终版为权威记录。

**无回退**：排期默认 4.2ms、标题自然序 3.3ms、状态顺序 31.3ms、持续时长 2.0ms、五级混合 95.9ms、工作台 26.2ms、十并发 0.0ms——全部维持达标。

**语义回归**：新增 `apps/server/test/custom-field-sort-index.test.ts` 11 例（快路径与 NULLIF 空白防御、数字/布尔/日期/日期时间语义、多级排序回落 JOIN 路径、值变更/改期/选项重排与新增/删除级联/JSON 导入恢复触发器联动、游标跨空值区推进、筛选与快路径组合、search 偏移分页适配器）；既有套件 206/206 全绿（含排序键金样、缺失值置后、单选选项序、准确总数与游标对账），typecheck 通过。migrate 测试的中间版本夹具补建 v1 即有的 custom_field_options 表（真实老库自带），版本断言 13→14。
