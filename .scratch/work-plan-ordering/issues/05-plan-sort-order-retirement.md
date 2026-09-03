# 规划工作计划 sortOrder 退役

Type: task
Status: resolved
Blocked by: 01

## Question

在不影响自定义字段排序的前提下，核查工作计划 `sortOrder` 和 `/work-plans/reorder` 的全部代码、脚本、自动化、导入导出及外部调用依赖，并据此确定停止输出、拒绝旧写入、删除契约与数据库列的兼容窗口和迁移顺序。

## Answer

- 2026-09-03 的全仓静态核查确认，工作计划 `sortOrder` 当前存在于以下兼容面：
  - `packages/contracts/src/index.ts` 的公共 Work Plan 契约、重排请求契约和共享排期比较器。
  - `apps/server/src/modules/work-plans.ts` 的读取排序、搜索兜底、创建赋值、序列化与重排事务。
  - `apps/server/src/routes/work-plans.ts` 的 `POST /api/v1/work-plans/reorder` 路由。
  - `apps/server/src/db/schema.ts` 与初始迁移中的 `work_plans.sort_order` 列和索引。
  - Web、Server、Bark 与 Viewer 验收测试中的 Work Plan 固定数据和旧重排行为模拟。
  - 原始 JSON 业务备份会通过 `SELECT *` 导出 `work_plans.sort_order`，导入器则按当前数据库列白名单接收旧字段。
- 仓库内没有发现工作计划页面、脚本、自动化或发布流程实际调用 `/work-plans/reorder`；目前唯一直接引用是服务端路由/授权测试和 Web 测试中的旧模拟。静态扫描无法证明仓库外 API 客户端不存在，因此兼容期仍需保留墓碑路由并记录调用。
- 自定义字段定义和单选选项的 `sortOrder`、`sort_order`、重排 API、环境配置导入导出及界面顺序属于不同领域语义，全部保留；任何迁移和机械替换都必须以 `work_plans`/`WorkPlan` 为边界，禁止全局删除同名字段。
- 退役分四阶段：
  1. 先交付统一查询引擎，使所有工作计划读取、搜索、提醒、导出和前端显示不再读取 Work Plan `sortOrder`；共享排期比较器改用开始时间、结束时间、创建时间和 ID。数据库列暂时保留，新建记录只写中性兼容值。
  2. 在同一兼容版本停止从公共 Work Plan 响应输出 `sortOrder`，移除公开重排请求契约；`POST /work-plans/reorder` 暂时保留为无副作用墓碑路由，返回 `410 Gone` 和稳定错误码，并记录不含敏感数据的调用计数。旧数值不迁移、不映射为任何新排序偏好。
  3. 兼容窗口持续到票据 06 定义的验收、观察和回退门槛全部满足。窗口内保留数据库列及版本 1–4 JSON 备份中的 `sort_order`，确保可以回滚到旧二进制；新记录的中性值只为满足旧 `NOT NULL` 约束。
  4. 窗口结束后重建 `work_plans` 表并删除 `sort_order` 与 `work_plans_sort_idx`，移除墓碑路由和剩余 Work Plan 类型/固定数据引用。JSON 业务备份升级版本：新版本不再导出该列，导入器继续接受版本 1–4 并忽略其遗留 `sort_order`，保证旧备份的数据语义仍可恢复。
- 每阶段都必须通过精确搜索证明只处理 Work Plan 排序，并覆盖契约、服务、路由、数据库迁移、JSON 备份兼容、Web/Server 测试和仓库内脚本；数据库删列前另做生产数据备份与迁移演练。外部调用的完成判据和兼容窗口时长由票据 06 锁定。

## Comments

- 2026-09-03：用户接受推荐的分阶段退役方向；本轮完成全仓静态依赖核查，未修改功能代码或数据库。
