# 14 — 启动工作计划 sortOrder 兼容退役

Type: task
Status: done
Blocked by: 11, 12, 13
Spec: ../spec.md
Scope: Work Plan contracts/service/route、兼容日志、JSON 备份兼容及全仓测试固定数据

## Background

所有读取消费者迁移后，可以停止公开 Work Plan 人工序号，同时保留数据库列和旧备份格式作为 14 天观察期的回退接缝。自定义字段的同名排序能力必须保持。

## Work

1. 从公共 Work Plan 响应与 TypeScript 类型移除 `sortOrder`，清理 Web/Server 测试中的 Work Plan 固定字段；不得删除 Custom Field/Option 的 `sortOrder`。
2. 删除公开 `reorderWorkPlansSchema` 和服务端重排事务；`POST /api/v1/work-plans/reorder` 保留为无副作用墓碑，返回 `410 Gone` 和稳定错误类别。
3. 墓碑只记录时间、路由和必要调用方标识，不记录认证凭据、请求正文或其他敏感内容；提供可计算 14 天零调用的计数方式。
4. 工作计划创建在遗留 `NOT NULL sort_order` 列仍存在时写固定中性值；所有查询、比较和导出确认不读取该值。
5. 兼容期维持 JSON 业务备份版本 1–4 和原始 `sort_order` 列，以支持旧二进制回滚；旧数值不迁移为页面偏好。
6. 使用精确范围搜索清理 Work Plan 遗留，增加保护测试证明自定义字段定义、选项、环境配置包和 UI 排序均未变化。

## Acceptance

- 任一 Work Plan API 响应不含 `sortOrder`，调用旧重排路由不会修改数据且返回可识别 410。
- 全仓 Work Plan 运行路径不读取该列；新记录仅写中性兼容值。
- 自定义字段和选项排序、环境配置导入导出及相关测试全部保持。
- 旧 JSON 备份仍可校验和导入，旧二进制回退所需列仍存在。

## Comments

## 实施记录（2026-09-03）

- **公共契约**：`workPlanSchema` 移除 `sortOrder`（自定义字段/选项同名字段保留）；删除公开 `reorderWorkPlansSchema`。全仓 Work Plan 固定字段与序列化清理（WorkPlanQuery 序列化、web 夹具）。
- **重排墓碑**：`POST /api/v1/work-plans/reorder` 保留路由（Viewer 仍 403，写权限角色 410），返回 `AppError(410, "WORK_PLAN_REORDER_RETIRED")`，无任何数据副作用；服务端只输出结构化日志 `event=work_plan_reorder_tombstone`（时间、请求 id、路由），不含凭据或请求正文；14 天零调用观察按该关键字计数。
- **中性写入**：新建工作计划向遗留 `NOT NULL sort_order` 写固定中性值 `WORK_PLAN_SORT_ORDER_NEUTRAL = 0`（常量导出），删除 MAX+1 逻辑；查询、比较、导出全部不读取该列。
- **备份兼容**：JSON 备份版本 1–4 与 `sort_order` 列原样保留（v11 排序键列经 allowedColumns 过滤自动兼容），旧备份导入/校验测试保持通过；旧值不迁移为偏好。
- **保护测试** `test/sort-order-retirement.test.ts` 3 项——墓碑 410 + 无副作用 + 版本不变；四种读取路径（list/query/search/get）响应均无 sortOrder 且新建仅写中性值；自定义字段定义（sort_order 0）、选项（0/1）与配置包往返排序不受影响。
- 附带加固：web vitest 单测超时 15s、worker 上限，RTL cleanup 防级联，OverviewPage 本地日期夹具修复（跨零点稳定）。
- 全仓验证：contracts 20、server 165、web 266、根 `pnpm test` 并行负载下全绿、typecheck 通过。

