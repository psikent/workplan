# 10 — 实现服务端统一查询与游标

Type: task
Status: ready-for-agent
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

