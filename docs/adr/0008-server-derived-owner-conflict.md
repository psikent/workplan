# Owner Conflict markers are computed globally by the server and returned as derived query fields

Status: accepted

负责人时段冲突（Owner Conflict）的判定与标记由服务端在每次工作计划查询时全局计算：`/work-plans/query`（以及按 id 取详情）在序列化每行时附加只读派生字段 `ownerConflict`（无冲突为 null）。判定语义集中在纯函数模块 `owner-conflicts.ts`——同 `customFields.owner` 值且非空、`[startAt, endAt)` 半开精确相交、双方状态活跃（pending/in_progress）、成对不传递；实时校核端点 `POST /work-plans/conflict-check` 复用同一函数。

## 动机：为什么不在前端算

前端列表与甘特共享同一查询（按可见周/月范围 + 状态筛选 + 分页，30s 轮询）。纯客户端用已取回的行算冲突会有系统性盲区：

- 冲突对象可能落在当前可见范围之外（别的周/月）；
- 可能被状态筛选、搜索词或自定义字段筛选排除；
- 可能因分页不在当前页。

盲区意味着漏报——而冲突提醒的价值恰恰在于指出「你看不到的地方」。服务端拿全量活跃任务计算后随行派生，每条响应的标记都是完整清单；30s 轮询与 mutation 失效自然刷新标记。

## Considered Options

- **客户端计算（用当前页数据）** — rejected：如上，范围/筛选/分页盲区导致漏报，且三处提醒（甘特/列表/浮动提示）与抽屉初始态各自实现，语义易漂移。
- **服务端全局计算 + 派生字段（采纳）** — 判定收敛为纯函数，查询管道一次投影（活跃 + owner 非空）扫描重叠对，`serializeRow` 附加结果。团队量级数百条，O(n log n) 开销可忽略，无需缓存。
- **用独立冲突列表端点关联已持久化查询行** — rejected：多一次往返与一层数据拼装，响应字段直出更符合现有 `ownerAccount` 派生字段的先例。此结论不适用于抽屉内尚未选定 owner 的草稿预览；草稿没有可供查询响应附加的已持久化行。

## Consequences

- `workPlanSchema` 响应新增 `ownerConflict`；创建/更新入参（strict）不含该字段，天然不可写。
- 冲突标记与请求的范围/筛选/分页无关；编辑抽屉的未保存实时校核另走 conflict-check 端点，两者共享同一判定函数，语义不会漂移。
- 判定输入投影包含 `status`（而非由 SQL 预筛活跃）：活跃条件是判定语义的一部分，收敛在纯函数内便于单元测试全覆盖。
- 按规格决策，冲突警示色统一走 amber 色板（与表单报错的 coral 拉开层级）；甘特 pending 状态本身即琥珀系，冲突条以更深的 `--gantt-bar-conflict` token 区分并以其余三处提醒补强辨识。
- owner 取值口径前提：产品约束 owner 字段应为 **single_select**——`ownerAccount` 派生（`owner-accounts.ts`）只认 single_select 选项；冲突判定接受任意文本列（text/url/date/datetime 的 COALESCE）是安全的超集，历史自由文本数据仍能标冲突。两侧读出的 owner 统一 trim，空串与纯空白视为未指派。
- 2026-09-10 修订：负责人选择前需要一次取得当前草稿时段内所有候选负责人的冲突数量，且当前草稿为 completed/cancelled 时不得提醒。抽屉因此改用独立的全候选预览查询，输入草稿的时间与状态模式，由服务端按同一 Owner Conflict 核心判定并返回按 owner 分组的 Counterparts；不从当前页面数据推算，也不逐候选发请求。
- 既有 `conflict-check` 端点保留兼容；抽屉的候选标记和选中后详情共用新的预览结果，避免两套请求产生口径或时序差异。预览只评估当前 Work Plan/Occurrence，编辑时排除自身，不展开 Recurring Series 的未来 Occurrences。
- 预览失败必须显式呈现「负责人冲突信息暂不可用」，并清除本轮候选标记，不能把未知状态显示成无冲突；失败不阻止选择或保存。
