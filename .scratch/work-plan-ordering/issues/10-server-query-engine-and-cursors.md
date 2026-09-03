# 10 — 实现服务端统一查询与游标

Type: task
Status: done
Blocked by: 09
Spec: ../spec.md
Scope: `apps/server/src/modules/`、`apps/server/src/routes/work-plans.ts`、所需数据库迁移与 Server 测试

## Background

当前 list 在 SQL 中使用旧兜底，search 会读入最多 10,000 条后在内存筛选排序。需要一个能驱动页面、兼容 API 和导出的服务端权威查询引擎。

## Work

1. 建立单一 Work Plan Query 模块：统一全文搜索、现有筛选、半开时间相交、动态字段验证、零至五项排序、排期兜底和序列化。
2. 按票据 08 的验证结果增加排序键、回填和索引迁移；所有排序键写入/更新必须与 Work Plan 和自定义字段值事务一致。
3. 实现 `POST /api/v1/work-plans/query`，返回准确 `total`、单次请求 `evaluatedAt`、当前页和 `nextCursor`；计数与页面在同一读事务中求值。
4. 实现版本化不透明游标和查询指纹，完整编码显式字段、缺失值标记、排期兜底和 ID。错误、过期版本和查询错配返回约定 400。
5. 使用键集条件获取后续页，不允许通过扩大内存上限或从头读取全部命中项模拟游标。
6. 让旧 list/search 方法成为统一引擎的 offset 适配器，保持旧数组响应和既有参数形状；删除原 search 的 10,000 条内存路径。
7. 添加 Server 集成测试：每种字段/方向、动态字段、归档和失效选项、准确总数、空/末页、同值、游标错配、静态数据无遗漏无重复及并发变化的已声明限制。

## Acceptance

- 新路由与旧适配器都由同一个查询模块生成顺序。
- 静态数据上遍历全部游标页与一次性完整查询完全一致。
- 所有排序和游标位置在数据库侧执行，查询计划使用预期索引且不存在固定 10,000 条上限。
- 更新排序字段后排序键同步，不产生可见陈旧顺序。
- Server typecheck/test 通过。

## Comments

## 实施记录（2026-09-03）

- **迁移 v11 `work_plan_sort_keys`**：`work_plans.title_sort_key`、`custom_field_values.text_sort_key/datetime_sort_key` 三列 + 18 个索引（单字段排序 × 完整排期兜底链复合索引、自定义字段键索引）；迁移执行器扩展 `backfill` 钩子，键重算（`db/sort-keys.ts`）与 SQL 同事务。旧备份恢复后全量重算键。
- **新模块 `modules/work-plan-query.ts`**：统一查询引擎——动态字段目录校验（未知/归档/不支持类型 → `SORT_FIELD_INVALID`/`SORT_FIELD_UNSUPPORTED` 稳定 422）、零至五项排序 + 排期兜底链去重、既有筛选能力（含多选 any/all EXISTS、datetime 归一键比较、半开范围 `end_at > from AND start_at < to`）、`COUNT` 与页查询同一读事务、limit+1 判定末页 `nextCursor=null`、base64url 游标（v/fp/pos/id，指纹覆盖 q/filters/range/sort；篡改/版本不符 → `CURSOR_INVALID` 400，指纹不符 → `CURSOR_MISMATCH` 400）。
- **空值双向置后**：可空列 ORDER BY 带 `(expr IS NULL) ASC` 前缀；键集谓词按上一页实际值分支生成（`buildCursorPredicate`/`buildKeyset`）。
- **`POST /api/v1/work-plans/query`**：请求契约 strict（AJV 层拒绝未知键），正文携带 offset 直接 422。
- **旧 list/search 成为引擎适配器**：数组响应 + offset 语义保留，10,000 条内存路径删除；旧接口时间范围随之采用半开语义。
- **写入维护**：create/update 写 `title_sort_key`；`custom-fields.setValues` 同事务写 `text_sort_key/datetime_sort_key`；**时间列在写入接缝统一为 `toISOString()` 形态**——修复 `Temporal.Instant.toString()` 零毫秒省略写法（`02:00:00Z`）与 `.000Z` 混存导致字典序 ≠ 时间点序的真实缺陷。
- **部署配置**：`openDatabase` 增加 `pragma temp_store = MEMORY`（票据 08 实测消除临时 B 树落盘的 p95 尖刺）。
- 测试：`test/work-plan-query.test.ts` 18 项（全部内置字段/方向、自定义字段七类、缺失值置后、失效单选、归档/未知/重复稳定错误、半开边界、any/all、准确总数、全量翻页无遗漏无重复、游标健壮性、实时视图限制、键写入同步、旧适配器 offset 等价）；migrate 测试夹具补齐业务表并升级到版本 11。server 155/155、web 261/261、全仓 typecheck 通过。

