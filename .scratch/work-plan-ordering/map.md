# 工作计划排序规则决策地图

Status: awaiting-approval
Type: map

## Destination

形成一份经确认的工作计划排序需求规格和可执行票据：明确每个读取场景从入选、分组、排序到分页与导出的完整语义，并能据此移除现有互相冲突的排序实现。

## Notes

- 领域：Work Planning；统一使用 Work Plan（工作计划），不引入独立的“任务”概念。
- 每次处理本地图时使用 `wayfinder`、`grilling` 和 `domain-modeling`。
- 本地图默认只做规划；功能实现、提交、发布均须在规格获批后另行授权。
- 当前代码事实：普通列表存在排期比较器，搜索、提醒和导出另有局部规则；工作计划 `sortOrder` 有写接口但没有页面入口，其全局序号语义与实际显示次序不一致。

## Decisions so far

- [确立工作计划排序体系的基础原则](./issues/01-establish-ordering-foundations.md) — 采用场景主序与统一排期兜底，由服务端权威执行，并退出工作计划人工 `sortOrder`。
- [明确工作台成员与日期边界](./issues/02-define-workbench-membership-and-date-boundaries.md) — 时间范围和本地日历日采用半开区间；三个计划区块互斥，提醒可与计划区块重复。
- [定义排序面板与偏好状态](./issues/03-define-sort-controls-and-preference-state.md) — 最多五字段排序，URL 优先于账户隔离浏览器偏好，并为失效、加载、失败和无障碍状态定义可见行为。
- [定义查询分页与并发契约](./issues/04-define-query-pagination-and-concurrency-contract.md) — 服务端统一查询，提供准确总数、不透明键集游标和实时视图，旧 offset 调用进入兼容层。
- [规划工作计划 sortOrder 退役](./issues/05-plan-sort-order-retirement.md) — 保留自定义字段排序，工作计划人工序号按查询脱钩、API 墓碑、观察窗口和数据库删列四阶段退出。
- [锁定验收、性能与上线边界](./issues/06-lock-acceptance-performance-and-rollout.md) — 以十万条标准数据集、500 ms 查询 p95、60 秒 XLS 和连续 14 天兼容观察作为推进门槛。
- [形成排序需求规格与实施票据](./issues/07-produce-spec-and-implementation-tickets.md) — 正式规格与 08–17 十张实施票据已经形成，等待用户批准后从自然排序与查询计划原型开始。

## Not yet specified

- 用户是否批准正式规格和实施票据进入开发；未批准前不修改功能代码、数据库或生产环境。

## Out of scope

- 月度目标、自定义字段定义、自定义字段选项、表格列和甘特显示属性自身的排序。
- JSON 数据备份中数据库表的物理行序；备份只保证数据语义。
- 本轮直接修改功能代码、迁移生产数据、提交、推送或发布。
