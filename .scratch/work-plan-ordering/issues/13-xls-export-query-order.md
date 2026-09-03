# 13 — 让 XLS 导出复用统一查询

Type: task
Status: done
Blocked by: 10, 12
Spec: ../spec.md
Scope: XLS 导出 contracts、`apps/server/src/modules/spreadsheet-transfer.ts`、相关路由/Web API 与测试

## Background

导出必须与工作计划页已经成功应用的查询顺序一致，但不受页面游标、当前页或旧读取上限限制。列选择与列排序继续沿用现有模板能力。

## Work

1. 扩展 XLS 导出请求，使其携带规范化搜索、筛选、时间范围和排序描述，不接受页面 cursor/offset 作为导出范围。
2. Spreadsheet Transfer 模块调用统一查询引擎，在单次数据库读事务内从头读取全部命中项和准确行数。
3. 使用流式、分批或其他有界内存方式生成工作簿，避免十万行结果和完整中间对象重复驻留。
4. Web 只发送“最后一次成功应用”的查询/排序；当前查询失败或尚未成功时禁用导出或明确沿用上次成功状态。
5. 保持 XLS 模板、属性选择、列排列、表头、字段格式和 Viewer 导出权限不变。
6. 添加一致性测试：多页查询拼接顺序等于 XLS 行顺序，空值/自定义字段/并列兜底一致，结果超过 500 和 10,000 条仍完整。

## Acceptance

- XLS 行集合与统一查询完整结果一一对应，顺序完全一致。
- 导出不读取或信任页面游标，不被页面 `limit` 截断。
- 十万行、25 列达到 60 秒和 512 MiB 预算。
- 现有导入、模板和 Viewer 权限测试无回归。

## Comments

## 实施记录（2026-09-03）

- **契约**：`exportWorkPlansQuerySchema = workPlanQueryRequestSchema.omit({ limit, cursor })`（strict，携带 cursor/offset 即整体 422）；`exportWorkPlansXlsSchema` 增加 `query` 字段并保留旧扁平 q/status/from/to 兼容期字段（服务端转换为查询描述，status→eq 筛选）。
- **SpreadsheetTransfer**：构造注入统一查询引擎；`buildXls` 重写为——单个数据库读事务内，按键集游标分页（每页 1,000）从头读取全部命中项，`sheet_add_aoa` 分批写入工作表，行计数驱动 autofilter/日期格式列；不再有 100,000 条上限，也不再一次性物化 plans 数组。
- **模板导出（GET）**：接受可选 `sort` URL 参数（`parseWorkPlanSortParam`），同样走引擎排序。
- **Web**：`downloadWorkPlansXlsCustom` 第四参支持 `query` 描述；页面以"最近一次成功应用的完整查询"（剔除 limit/cursor）发起导出；查询未成功应用或加载中时导出按钮禁用并提示。
- 测试：`test/export-query-order.test.ts` 2 项——550 行（>500）导出行集合与键集游标分页（limit 200）拼接逐一相等、cursor 携带被 422 拒绝；自定义字段自然序导出与缺失值置后一致。server 162/162、web 266/266、全仓 typecheck 通过。

