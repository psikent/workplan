# 09 — 建立统一排序与查询契约

Type: task
Status: done
Blocked by: 08
Spec: ../spec.md
Scope: `packages/contracts/src/index.ts`、契约测试及由 08 选定的共享排序基础

## Background

当前 Work Plan 契约暴露 `sortOrder`，共享排期比较器还把重复来源和人工序号作为并列规则，搜索契约只支持 offset 数组结果。本票据先建立后续服务端与 Web 共同依赖的稳定语言和数据结构。

## Work

1. 定义排序字段、方向、最多五项、唯一性、查询范围、游标请求和 `{ items, total, evaluatedAt, nextCursor }` 响应契约。
2. 保留可由静态 schema 判断的字段白名单；动态自定义字段存在性、归档状态和类型由服务端目录校验。
3. 建立稳定错误类别：非法/重复/不支持排序字段、非法游标、游标查询不匹配及重排退役。
4. 把 `compareWorkPlansBySchedule` 改为开始升序、结束降序、创建升序、ID 升序，移除 `seriesId` 和 Work Plan `sortOrder` 依赖。
5. 根据票据 08 结果提供同语义的文本排序键/参考比较器与状态、布尔、日期、持续时长、缺失值规范化工具；避免 UI 和 Server 各写一套规则。
6. 暂不在本票删除公共 Work Plan 的 `sortOrder` 字段；兼容切换由票据 14 在所有消费者迁移后完成。
7. 添加契约和金样测试，覆盖严格输入、五项上限、重复字段、状态顺序、文本自然顺序、缺失值和排期兜底。

## Acceptance

- 新查询请求/响应可由 TypeScript 和 Zod 共同推导，非法输入在路由前稳定失败。
- 排期比较器不再读取重复来源或 Work Plan `sortOrder`。
- 参考比较器与票据 08 选定的数据库排序语义通过同一金样。
- 现有 contracts 测试及全仓 typecheck 通过。

## Comments

## 实施记录（2026-09-03）

- `packages/contracts/src/index.ts`：新增 `workPlanQueryRequestSchema`（q/filters/range/sort/limit/cursor，游标契约无 offset）、`workPlanQueryResponseSchema`（items/total/evaluatedAt/nextCursor）、`workPlanSortItemSchema`（静态白名单 title/status/startAt/endAt/duration/createdAt/updatedAt + `custom.<key>`，最多五项、superRefine 拒绝重复）、`workPlanQueryErrorCodes`（六类稳定错误）、URL 参数 `format/parseWorkPlanSortParam`。
- `compareWorkPlansBySchedule` 重写为开始升序、结束降序、创建升序、ID 升序（码点序，返回值归一化 -1/0/1），Pick 类型不再含 `seriesId`/`sortOrder`；Web 旧断言"重复优先"已按新规格更新。
- 票据 08 排序键方案 A 的共享实现入库：`normalizeTextForSort`/`naturalSortKey`/`compareNaturalSortKeys`/`compareNaturalText`（码点序等价 UTF-8 字节序，无 Buffer 依赖，Web/Server 共用）与 `workPlanStatusOrder`。
- 公共 Work Plan 契约暂保留 `sortOrder`（票据 14 移除）。
- 测试：`packages/contracts/test/sorting.test.mjs` 21 项（五项上限、重复、白名单、请求/响应契约、错误类别、URL 参数、排期比较器四级、金样 12 组与独立参考比较器交叉验证）；contracts 21/21、server 137/137、web 261/261、全仓 typecheck 通过。

