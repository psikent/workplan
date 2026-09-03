# 票据 08 原型验证报告
- 生成时间：2026-09-03T13:29:55.071Z
- Node v24.18.0，better-sqlite3 12.11.1
- 数据库：/Users/psikent/dev/workplan-dev/data/prototype-sorting.db（WAL，pragma 与应用一致）

## 1. 自然文本金样（参考比较器 vs 排序键字节序）
- [PASS] 数字片段按数值: 第1期检修 ／ 第2期检修 ／ 第10期检修 ／ 第99期检修 ／ 第100期检修
- [PASS] 版本号式数字段: v1.2.4 ／ v1.2.30 ／ v1.9.0 ／ v1.10.0
- [PASS] 忽略大小写（并列由兜底决定）: ABC 项目 ／ abc 项目
- [PASS] 全角半角等价: ａｂｃ１号 ／ abc1号 ／ ＡＢＣ１号
- [PASS] 组合字符规范化: Cafe 平台 ／ café é ／ café 平台
- [PASS] 中文与 ASCII 混排: Plan 2 审查 ／ Plan 10 审查 ／ 专项 3 复核 ／ 作业计划 9 号机 ／ 作业计划 10 号机
- [PASS] 前导零等值: 批次007 ／ 批次7 ／ 批次08 ／ 批次8
- [PASS] 空白差异保留:  a ／ a	b ／ a  b ／ a b
- [PASS] 超长数字按数值: 编号12345678901234567890123456789012345678901234567890 ／ 编号12345678901234567890123456789012345678901234567891 ／ 编号99999999999999999999999999999999999999999999999999 ／ 编号100000000000000000000000000000000000000000000000000
- [PASS] 中文码点序（无拼音要求）: 白菜 ／ 苹果 ／ 豆角 ／ 香蕉
- [PASS] 数字先于文本段: a1 ／ a2b ／ ab
- [PASS] 空串与控制字符剔除:  ／ 杂项 ／ 杂项

## 2. 数据集与建库
- 工作计划 100000 条，自定义字段 50 个（归档 3 个），值行 1354164 条，多选行 67611 条
- 建库与插入完成：4846 ms
- 标题排序键回填：回填前缺失 100000，回填 100000 行耗时 554 ms，回填后缺失 0
- 回填示例：批次004451验证 → "\u0002批次\u00010000044451\u0002验证"；批次017873验证 → "\u0002批次\u000100000517873\u0002验证"；批次013058验证 → "\u0002批次\u000100000513058\u0002验证"
- 排序索引与 ANALYZE 完成
- 写入维护演示：200 条标题更新后键同步一致 ✓

## 3. 归档字段校验（引擎入口拒绝）
- 归档字段 cf-003 → {"error":"FIELD_ARCHIVED"}
- 可用字段 cf-001 → {"ok":true}

## 4. EXPLAIN QUERY PLAN（首页 SQL）

### schedule-default（排期兜底，无显式排序）
  SCAN wp USING INDEX idx_wp_schedule_full

### schedule-filtered（排期兜底 + 状态/时间/全文筛选）
  SEARCH wp USING INDEX idx_wp_schedule_full (start_at<?)

### title-asc（标题自然序升序，含排期兜底链）
  SCAN wp USING INDEX idx_wp_title_key_asc

### title-desc（标题自然序降序）
  SCAN wp USING INDEX idx_wp_title_key_desc

### title-asc-filtered（标题自然序 + 全部筛选）
  SEARCH wp USING INDEX work_plans_status_idx (status=?)
  USE TEMP B-TREE FOR ORDER BY

### status-asc（状态顺序）
  SCAN wp USING INDEX idx_wp_status_order

### duration-asc（持续时长表达式索引）
  SCAN wp USING INDEX idx_wp_duration

### cf-text-asc（自定义短文本自然序，LEFT JOIN + 临时排序）
  SCAN wp USING INDEX sqlite_autoindex_work_plans_1
  SEARCH cfv USING INDEX sqlite_autoindex_custom_field_values_1 (work_plan_id=? AND field_id=?) LEFT-JOIN
  USE TEMP B-TREE FOR ORDER BY

### cf-number-desc（自定义数字降序，LEFT JOIN + 临时排序）
  SCAN wp USING INDEX sqlite_autoindex_work_plans_1
  SEARCH cfv USING INDEX sqlite_autoindex_custom_field_values_1 (work_plan_id=? AND field_id=?) LEFT-JOIN
  USE TEMP B-TREE FOR ORDER BY

### cf-select-asc（自定义单选按选项序，失效值置后）
  SCAN wp USING INDEX sqlite_autoindex_work_plans_1
  SEARCH cfv USING INDEX sqlite_autoindex_custom_field_values_1 (work_plan_id=? AND field_id=?) LEFT-JOIN
  SEARCH cfo USING INDEX sqlite_autoindex_custom_field_options_2 (field_id=? AND value=?) LEFT-JOIN
  USE TEMP B-TREE FOR ORDER BY

### cf-datetime-desc（自定义日期时间归一键降序）
  SCAN wp USING INDEX sqlite_autoindex_work_plans_1
  SEARCH cfv USING INDEX sqlite_autoindex_custom_field_values_1 (work_plan_id=? AND field_id=?) LEFT-JOIN
  USE TEMP B-TREE FOR ORDER BY

### five-level-mixed（五级混合：标题/状态/开始/自定义数字/创建 + 筛选）
  SEARCH wp USING INDEX work_plans_status_idx (status=?)
  SEARCH cfv2 USING INDEX sqlite_autoindex_custom_field_values_1 (work_plan_id=? AND field_id=?) LEFT-JOIN
  USE TEMP B-TREE FOR ORDER BY

## 5. 性能（预热文件库，30 次迭代；首页 = 事务内 COUNT + 前 100 条；次页 = 键集游标第 2 页；单位 ms）
| 用例 | 首页 p50 | 首页 p95 | 首页 p99 | 次页 p50 | 次页 p95 | 次页 p99 | 预算内(500ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| schedule-default（排期兜底，无显式排序） | 0.6 | 0.7 | 0.8 | 0.2 | 0.2 | 0.3 | 是 |
| schedule-filtered（排期兜底 + 状态/时间/全文筛选） | 18.4 | 19.7 | 21.6 | 4.4 | 4.6 | 5.0 | 是 |
| title-asc（标题自然序升序，含排期兜底链） | 0.7 | 0.8 | 0.8 | 0.2 | 0.3 | 0.8 | 是 |
| title-desc（标题自然序降序） | 0.7 | 0.7 | 0.8 | 0.2 | 0.2 | 0.2 | 是 |
| title-asc-filtered（标题自然序 + 全部筛选） | 27.0 | 29.8 | 55.4 | 13.8 | 16.0 | 16.4 | 是 |
| status-asc（状态顺序） | 0.7 | 0.8 | 0.8 | 0.2 | 0.2 | 0.2 | 是 |
| duration-asc（持续时长表达式索引） | 0.7 | 0.8 | 0.9 | 0.2 | 0.3 | 0.3 | 是 |
| cf-text-asc（自定义短文本自然序，LEFT JOIN + 临时排序） | 156.8 | 245.5 | 291.0 | 234.7 | 318.5 | 365.5 | 是 |
| cf-number-desc（自定义数字降序，LEFT JOIN + 临时排序） | 151.6 | 359.4 | 366.9 | 236.6 | 332.0 | 342.7 | 是 |
| cf-select-asc（自定义单选按选项序，失效值置后） | 199.7 | 546.4 | 718.9 | 257.7 | 674.3 | 825.1 | 否 |
| cf-datetime-desc（自定义日期时间归一键降序） | 177.1 | 1285.7 | 1495.5 | 264.6 | 3077.2 | 3165.9 | 否 |
| five-level-mixed（五级混合：标题/状态/开始/自定义数字/创建 + 筛选） | 54.4 | 83.1 | 85.7 | 28.7 | 72.2 | 147.9 | 是 |

## 5b. temp_store=MEMORY 对照实验（验证临时 B 树落盘对 p95 尖刺的影响）
| 用例 | 首页 p50 | 首页 p95 | 首页 p99 | 次页 p95 | 预算内(500ms) |
| --- | --- | --- | --- | --- | --- |
| cf-text-asc（自定义短文本自然序，LEFT JOIN + 临时排序） | 156.0 | 210.3 | 373.0 | 323.7 | 是 |
| cf-number-desc（自定义数字降序，LEFT JOIN + 临时排序） | 139.9 | 159.9 | 167.0 | 231.8 | 是 |
| cf-select-asc（自定义单选按选项序，失效值置后） | 168.2 | 192.8 | 209.1 | 240.0 | 是 |
| cf-datetime-desc（自定义日期时间归一键降序） | 141.1 | 255.9 | 302.3 | 622.5 | 否 |
| five-level-mixed（五级混合：标题/状态/开始/自定义数字/创建 + 筛选） | 51.7 | 205.8 | 450.1 | 119.1 | 是 |
- 结论：若 p95 尖刺消失，生产配置应与应用现有 WAL/busy_timeout 一样拥有 temp_store=MEMORY；真实迁移与查询引擎按此配置部署。

## 6. 游标语义与全量遍历对账（静态数据无遗漏、无重复、与参考实现全序一致）
- [PASS] schedule-default（排期兜底，无显式排序）: 100000 行 / 201 页 / 无重复 true / 与参考实现全序一致 true（1042 ms）
- [PASS] schedule-filtered（排期兜底 + 状态/时间/全文筛选）: 1739 行 / 4 页 / 无重复 true / 与参考实现全序一致 true（71 ms）
- [PASS] title-asc（标题自然序升序，含排期兜底链）: 100000 行 / 201 页 / 无重复 true / 与参考实现全序一致 true（4429 ms）
- [PASS] title-desc（标题自然序降序）: 100000 行 / 201 页 / 无重复 true / 与参考实现全序一致 true（4174 ms）
- [PASS] title-asc-filtered（标题自然序 + 全部筛选）: 2400 行 / 5 页 / 无重复 true / 与参考实现全序一致 true（168 ms）
- [PASS] status-asc（状态顺序）: 100000 行 / 201 页 / 无重复 true / 与参考实现全序一致 true（976 ms）
- [PASS] duration-asc（持续时长表达式索引）: 100000 行 / 201 页 / 无重复 true / 与参考实现全序一致 true（1549 ms）
- [PASS] cf-text-asc（自定义短文本自然序，LEFT JOIN + 临时排序）: 前 300 行与参考实现头部一致
- [PASS] cf-number-desc（自定义数字降序，LEFT JOIN + 临时排序）: 前 300 行与参考实现头部一致
- [PASS] cf-select-asc（自定义单选按选项序，失效值置后）: 前 300 行与参考实现头部一致
- [PASS] cf-datetime-desc（自定义日期时间归一键降序）: 前 300 行与参考实现头部一致
- [PASS] five-level-mixed（五级混合：标题/状态/开始/自定义数字/创建 + 筛选）: 前 300 行与参考实现头部一致
- 准确总数与遍历行数一致：total=100000，walked=100000

## 7. 游标健壮性
- 合法游标：返回 100 行
- 篡改 base64 → INVALID_CURSOR
- 指纹不符 → CURSOR_MISMATCH（稳定 400）
- 非法格式 → INVALID_CURSOR
- 版本不符 → INVALID_CURSOR

## 8. 方案对比
### 方案 B：SQLite 扩展 / ICU
- 当前 SQLite 编译选项含 ICU：否（better-sqlite3 捆绑构建，版本随 npm 包固定）
- loadExtension 失败（预期）：dlopen(libicu.dylib, 0x000A): tried: 'libicu.dylib' (no such file), '/System/Volumes/Preboot/Cryptexes/OSlibicu.dylib' (no such file), '/usr/lib/libicu.dylib' (no such file, not in dyld cache), 'libicu.dylib' (no such file)
- 结论：better-sqlite3 12.11.1 的 JS API 无 collation 注册接口（实例方法仅 prepare/transaction/pragma/backup/serialize/function/aggregate/table/loadExtension/exec 等）；捆绑构建无 ICU；扩展二进制无法随 pnpm 部署产物跨平台可靠分发 → 不可部署，拒绝。
### 方案 C：确定性自定义 SQL 函数 + 表达式索引
- 表达式索引创建成功；5 万行写入（每行触发 JS 函数）165 ms；排序前 100 条 0.1 ms
- 计划：SCAN t2 USING COVERING INDEX t2_nk
- 运维风险：任何读取该索引的连接（sqlite3 CLI、备份/完整性工具、未注册函数的旧进程）都会报 no such function；写入路径每行触发 JS；不采用，记录为可行备选。
### 方案 D：读取全部命中项后在 Node.js 排序（票据禁止作为通过方案，仅作对照）
- 全量读取 + JS 排序 10 万行（含完整兜底链）：233 ms，前 100 条与键集引擎一致：true

## 9. 结论
- 方案 A（应用写入时生成规范化排序键、数据库持久化并以 BINARY 比较）是唯一同时满足金样、可部署性与性能预算的候选；后续票据按此实施。
- 排序键算法：NFKC → 大写折叠 → 剔除控制字符 → 数字段/文本段分段编码（数字段 = 0x01 + 定长位数 + 去前导零数字串；文本段 = 0x02 + 文本字节），UTF-8 字节序即全序。
- 时间列写入时归一化 UTC ISO（应用当前即为 toISOString()）；自定义 datetime 值新增 datetime_sort_key 归一键；自定义短文本/URL 新增 text_sort_key。
- 单字段排序用复合索引（排序列 + 完整排期兜底链）完全走索引；自定义字段与五级混合排序依赖临时 B 树排序，实测见第 5 节。
- 空值双向置后的键集谓词必须按上一页实际值分支生成（NULL = NULL 不成立），已在 buildKeyset 实现并经全量遍历验证。
