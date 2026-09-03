# 17 — 删除工作计划 sortOrder 数据库遗留

Type: task
Status: ready-for-agent
Blocked by: 16
Spec: ../spec.md
Scope: `work_plans` 数据库迁移、Drizzle schema、JSON 备份新版本、墓碑删除与最终回归

## Background

只有生产兼容观察和用户放行完成后，才能删除仍为回退保留的 Work Plan `sort_order` 列、索引和墓碑路由。旧数值没有新业务含义。

## Work

1. 再次精确扫描 Work Plan `sortOrder`/`sort_order` 依赖并确认票据 16 的放行证据；自定义字段和选项同名字段排除在迁移之外。
2. 在删除列前执行可恢复备份和迁移演练；SQLite 迁移以事务安全方式重建 `work_plans`，保留所有约束、外键、索引和数据，但不复制 `sort_order`。
3. 删除 `work_plans_sort_idx`、Drizzle Work Plan 字段、中性写入及重排墓碑路由/统计。
4. JSON 业务备份升级版本，新导出不包含 Work Plan `sort_order`；导入器继续接受版本 1–4，并在新表上忽略遗留列。增加旧备份恢复测试。
5. 提供并演练前向修复：若旧二进制必须临时回滚，可事务性重新加入非空中性 `sort_order` 和索引，而不整库回档。
6. 运行完整数据迁移、备份导入、查询、工作台、提醒、Web、XLS、typecheck/test 和性能回归。

## Acceptance

- 生产目标 schema 不再含 `work_plans.sort_order` 或其索引，应用中无 Work Plan 同名依赖。
- 所有业务数据、关系、版本和新排序结果在迁移前后保持正确。
- 版本 1–4 旧备份仍可导入，新备份不再携带遗留列。
- 自定义字段定义、选项及其排序 API/配置包完全不受影响。
- 完整回归与性能门槛通过，并记录最终迁移和回退证据。

## Comments

