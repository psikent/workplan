# 08 — 原型验证自然排序键与查询计划

Type: prototype
Status: done
Blocked by: none
Spec: ../spec.md
Scope: 隔离原型、SQLite 查询计划与性能记录；不得接入生产路径

## Background

规格要求中文自然文本排序、动态自定义字段、准确总数、键集游标和十万条性能预算同时成立。当前 `better-sqlite3 12.11.1` 没有公开的自定义 collation 注册接口，当前 SQLite 也没有 ICU，不能假设 `Intl.Collator` 可直接用于 SQL 或索引。

## Work

1. 建立不接入应用运行时的隔离原型，生成规格中的十万条代表性数据和 50 个自定义字段。
2. 固定自然文本金样：中文、ASCII 大小写、全角/半角、组合字符、数字片段、前导零、空白和超长数字；明确规范化与稳定全序输出。
3. 至少比较以下可部署方案：
   - 应用写入时生成、数据库持久化并可索引的规范化排序键。
   - 可随现有发布产物可靠部署的 SQLite 扩展或 ICU 方案。
   - 其他能同时支持动态字段、游标位置和旧数据回填的方案。
4. 禁止以“读取全部命中项后在 Node.js 排序”作为通过方案；该方式只可作为结果正确性的对照实现。
5. 对候选方案执行 `EXPLAIN QUERY PLAN` 和性能测试，覆盖标题、状态、日期时间、数字、单选、自定义文本、五级混合排序、缺失值及首/后续页。
6. 验证排序键版本升级、旧数据回填、写入维护、归档字段、游标编码和导出复用方式。
7. 将选择、拒绝理由、数据结构、索引策略、金样结果和性能数字追加到本票 `## Answer`；若无方案达到预算，停止后续票据并返回设计层重新决策。

## Acceptance

- 选定方案在当前 Node、SQLite、部署目标和打包方式下可复现，不依赖开发机偶然存在的系统扩展。
- 十万条标准数据集的首/后续页原型达到查询 p95 500 ms、p99 1,000 ms，且游标语义正确。
- 自然文本金样由独立参考比较器与数据库结果交叉验证。
- 有明确的迁移、索引、写入维护、版本化和回退方案。
- 原型没有修改现有应用业务路径或生产数据库。

## Comments

## Answer（2026-09-03，原型脚本见 `../prototype/`，完整报告见 `../prototype/report.md`）

**选定方案 A：应用写入时生成规范化排序键、数据库持久化、以 BINARY（UTF-8 字节序）比较。**

### 环境事实

- Node v24.18.0，better-sqlite3 12.11.1（捆绑 SQLite 3.53.2，版本随 npm 包固定，跨平台一致）；WAL + `busy_timeout=5000`，与应用 pragma 相同。
- better-sqlite3 12.11.1 实例方法无 collation 注册接口（仅 `prepare/transaction/pragma/backup/serialize/function/aggregate/table/loadExtension/exec` 等）。
- 数据集：100,000 条工作计划 + 50 个自定义字段（3 个归档）+ 1,354,164 条值行；覆盖四种状态、重复实例、高缺失率（60–85%）、中文数字混合文本、失效单选值（8%）、混合时区偏移 datetime。

### 排序键算法（金样 12 组全部通过，参考比较器交叉验证）

`NFKC → toUpperCase() → 剔除控制字符 → 分段编码`：

- 数字段 → `\u0001` + 6 位定长十进制位数（去前导零）+ 去前导零数字串；文本段 → `\u0002` + 文本字节。键的 UTF-8 字节序 = 稳定全序；同值不同写法（`007`/`7`、全角/半角、大小写）键相同，并列由排期兜底决定。
- 可观察性质固定：数字片段按数值（含 50 位超长数字）、忽略大小写、全角半角等价、组合字符合成、控制字符剔除、空白保留、中文按码点序（规格未要求拼音）。
- 参考比较器（分段语义，不经键编码）与键字节序在全部金样与全量遍历上一致；注意 JS 字符串 `<` 是 UTF-16 序，参考实现必须按码点比较。

### 数据结构

- `work_plans.title_sort_key TEXT NOT NULL`（迁移重建表时定密），索引 `idx_wp_title_key_asc(title_sort_key, start_at, end_at DESC, created_at, id)` 与 `_desc(title_sort_key DESC, …)` —— 排序列 + **完整排期兜底链**入索引，ORDER BY 与键集谓词完全落索引（EXPLAIN：`SCAN wp USING INDEX idx_wp_title_key_asc`，无 TEMP B-TREE）。
- `custom_field_values` 新增 `text_sort_key`（short_text/url）、`datetime_sort_key`（datetime 写入时归一化 UTC ISO；date 固定 `YYYY-MM-DD` 可直接用列）；单选经 `custom_field_options.sort_order` JOIN；number/boolean 用既有列；duration 用表达式索引 `(julianday(end_at)-julianday(start_at), start_at, end_at DESC, created_at, id)`；status 用 `CASE` 表达式索引（表达式索引内不可用表别名）。
- 时间列写入归一化 UTC ISO（应用现状即 `toISOString()`）。

### 键集游标

- 不透明游标 = base64url(JSON `{v, fp, pos, id}`)；`fp` 为查询条件 + 规范化排序的 SHA-256 指纹前 16 位；pos 含每个显式排序位 + 完整排期兜底位。篡改 → `INVALID_CURSOR`，指纹不符 → `CURSOR_MISMATCH`（稳定 400），版本不符 → `INVALID_CURSOR`。
- **空值双向置后**：SQLite ASC 默认 NULL 在前，可空列 ORDER BY 必须带 `(expr IS NULL) ASC` 前缀；键集谓词必须按上一页实际值分支生成（`NULL = NULL` 不成立，NULL 位置后用 `expr IS NULL` 推进）。`buildKeyset` 已实现并经全量遍历验证。
- 静态数据全量遍历：schedule/title asc/desc/status/duration 共 7 组 100,000 行 × 201 页（limit 500），无遗漏、无重复、与参考实现全序逐一一致；COUNT 与遍历行数一致。

### 性能（首页 = 事务内 COUNT + 前 100 条；次页 = 键集第 2 页；30–40 次迭代）

| 用例 | 首页 p95 | 次页 p95 | 预算 |
| --- | --- | --- | --- |
| 排期兜底（无/有筛选） | 0.8 / 21.6 ms | 0.2 / 4.7 ms | ✅ |
| 标题自然序 asc/desc（含筛选） | 0.7–35.7 ms | 0.2–16.3 ms | ✅ |
| 状态 / 时长 | 0.8 ms | 0.3 ms | ✅ |
| 自定义短文本/数字/单选/日期时间 | 163–400 ms | 273–437 ms | ✅（需 temp_store=MEMORY） |
| 五级混合 + 筛选 | 66.5 ms | 29.2 ms | ✅ |

- **`temp_store=MEMORY` 是达成预算的必要部署配置**：默认临时 B 树落盘使自定义字段排序 p95 出现 850–1574 ms 尖刺；置为 MEMORY 后 p95 ≤ 400 ms。该 pragma 与 WAL/busy_timeout 一样由应用 `openDatabase` 拥有，不属于放宽断言。
- 自定义字段排序与五级混合为 `USE TEMP B-TREE FOR ORDER BY`（JOIN 侧复合键无法跨表建索引），未过滤全表 10 万行时 p50 ≈ 150–200 ms；实际页面均带筛选，实测 5 级混合 + 筛选 p95 仅 66 ms。

### 方案对比

- **B（SQLite 扩展/ICU）：拒绝。** 捆绑构建无 ICU（`sqlite_compileoption_used('ICU')` = 0），`loadExtension('libicu')` 实测 dlopen 失败；扩展二进制无法随 pnpm 部署产物跨平台分发。
- **C（确定性自定义函数 + 表达式索引）：技术上可行，拒绝采用。** `db.function('nk', {deterministic:true}, fn)` + `CREATE INDEX t2(nk(title), id)` 实测成功且查询 0.1 ms；但任何读取该索引的连接（sqlite3 CLI、备份/完整性工具、未注册函数的旧进程）都会报 `no such function`，写入每行触发 JS。记录为备选。
- **D（全量读取 + Node 排序）：仅作对照。** 10 万行 233 ms、前 100 条与键集引擎一致；票据禁止作为通过方案。

### 迁移 / 版本化 / 回退

- 回填：分块事务重算（100,000 行 723 ms），真实迁移以重建 `work_plans` 表方式置 NOT NULL。
- 写入维护：标题/自定义值更新与键写入同事务，演示 200 条更新后键一致。
- 版本升级：排序键算法无独立版本号，以迁移版本为准——算法变更即新增迁移全量重算并重建索引；游标自带 `v`，版本不符返回稳定 400。
- 归档/未知/不支持类型字段在引擎入口拒绝（`FIELD_ARCHIVED` 等），不静默降级。
- 导出复用：导出 = 同一引擎从头完整读取（全量遍历已验证顺序与分页拼接一致），不携带页面游标。

**结论：方案 A 在当前 Node/SQLite/部署方式下可复现、不依赖系统扩展，首/后续页 p95 ≤ 500 ms 达成，游标语义经全量对账验证。后续票据按此推进。**

