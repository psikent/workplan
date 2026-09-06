# 17 — 删除工作计划 sortOrder 数据库遗留

Type: task
Status: done
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

### 实施记录（2026-09-07）

**放行依据**：用户在会话中明确指示执行本票（票据 16 已于同日由用户确认闭环）。

- **精确扫描**：全仓 `sort_order`/`sortOrder` 依赖点逐一定性。删除项——`workPlans.sortOrder` 字段与 `work_plans_sort_idx`（schema.ts）、`WORK_PLAN_SORT_ORDER_NEUTRAL` 中性写入（work-plans.ts）、重排墓碑路由与 `reorderRetired`（routes/errors.ts）、`WorkPlanRow.sort_order`（work-plan-query.ts）、perf-benchmark 及测试 INSERT 中的该列。保留项——customFieldDefinitions/Options 的同名 `sort_order` 及其全部 API/配置包路径（env-config.ts、custom-fields 路由、Web 排序）原样未动；迁移 1 的历史 SQL 不改写，由 v13 完成删列。
- **迁移 v13 `drop_work_plan_sort_order`**（migrate.ts）：SQLite 不支持原地删列，按官方流程重建 `work_plans`——外键关闭下 CREATE `work_plans_new`（保留 status_mode CHECK、UNIQUE(series_id, occurrence_key)、work_plan_series 外键）→ INSERT..SELECT 复制除 sort_order 外全部 15 列 → DROP 旧表 → RENAME → 除 `work_plans_sort_idx` 外 14 个索引逐字重建。必须 `requiresForeignKeysOff`：外键开启时 DROP 的隐式 DELETE 会 CASCADE 清空 custom_field_values、SET NULL 清空 monthly_goals。`verifyTables: ["work_plans"]` 沿用迁移 9 先例——custom_field_values 存在指向已删计划的历史悬挂行，扩大校验会让无关脏数据阻断生产升级。
- **JSON 备份 v5**（transfer.ts）：新导出 `schemaVersion: 5`（SELECT * 自然不含该列）；导入器接受 1–5，allowedColumns（PRAGMA table_info）过滤使 v1–4 备份中的 `sort_order` 键自动忽略；contracts `importPayloadSchema` 同步 1–5。新增 v4 旧备份（行内注入 `sort_order: 100-index`）校验+导入+数据完整性测试。
- **前向修复**（scripts/forward-fix-sort-order.ts）：幂等、事务性 ADD COLUMN `sort_order INTEGER NOT NULL DEFAULT 0` + 重建 `work_plans_sort_idx`；已演练——加列回填 63 行中性值 0、索引就位、旧二进制风格 INSERT（16 列含 sort_order）写入成功。
- **迁移演练**（scripts/rehearse-v13.ts，真实库副本）：v12→v13 成功；63 计划/1139 自定义字段值/18 月度目标逐表相符；列清单与索引完整（含 2 个自动索引）；`foreign_key_check(work_plans)` 零违例、`integrity_check ok`；统一查询引擎（默认序 + 标题序）total=63 正常；导出 v5 且行无 sort_order，回环 validate 通过。真实生产库将在 hook 发布后由启动迁移自动升级（发布有停机窗口，迁移事务安全）。
- **回归**：全仓 typecheck 绿；contracts 24、server 16 文件 189 项（含新 sort-order-removal 5 项与 migrate v13 专项——完整 16 索引清单断言）、web 17 文件 296 项全绿；XLS 导出/导入、工作台、提醒、viewer 授权（reorder 请求移除）随套件覆盖。
- **性能**（十万行标准数据集，perf-report.md 已更新）：执行计划（EXPLAIN）与基线逐字节一致；排期/标题/状态/时长/五级混合、工作台（p95 24.8ms）、十并发（p95≈0ms）、XLS 时间（36.8s）全部达标，非 JOIN 用例多数显著快于基线（排期默认 p50 13.2→2.8ms）。自定义字段 JOIN 排序三用例 p95 仍超 500ms——与票据 15 基线中已记录的 temp B-TREE 已知偏差同源（基线即含 次页自定义数字 835ms ❌），同一构建两次运行 p95 相差 6 倍（562 vs 3404ms）证明环境负载主导该数值，无新增回归；XLS 内存超 512MiB 为 SheetJS 既有记录（容器决策见报告）。两项均为票据 15/16 已接受的既有偏差，非本次引入。
- **审查门**：code-reviewer 全量审查通过——P0/P1 为零；2 项 P2 已修（contracts 错误码列表移除 `WORK_PLAN_REORDER_RETIRED`、`importPayloadSchema` 版本升 5）；1 项 P3 加固落实（migrate 测试改为完整索引清单断言）。
- **生产删列前置条件（规格 Rollout and Rollback）**：① 迁移演练（见上）；② 可恢复备份——2026-09-07 通过 better-sqlite3 在线 backup API（只读连接）对生产库 `/var/opt/workplan-release/data/workplan.db` 完成一致性快照 `data/workplan-pre-v13-backup.db`（备份文件 integrity ok，schema v12，84 计划/1582 自定义字段值/39 月度目标，与源库逐表相符）。生产发布后启动迁移自动升到 v13；如需回滚，先跑 `scripts/forward-fix-sort-order.ts` 加回列再回退应用。
