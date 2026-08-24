# 重复周期测试与验证（tests）
Type: task
Status: resolved
Blocked by: 06, 07

## 背景
规格 R10/验收 7。补齐服务端与 Web 自动化测试,更新受 schemaVersion 4 影响的既有断言。
## 改动清单
1. 扩展 apps/server/test/monthly-goals.test.ts（或新文件）：系列创建生成期数（步长/相交/无界 422/600 上限）、实例独立（编辑/归档/删除实例不影响系列）、PATCH 补期不删实例、停止、editor 两种认证、导出 v4 含 series、v1/v2/v3 导入兼容。
2. 扩展 apps/web/src/pages/MonthlyGoalsPage.test.tsx：重复周期区块渲染与提交 payload、系列徽标与对话框（编辑规则/停止）、实例独立编辑回归。
3. 更新既有断言：app.test.ts（schemaVersion 4、v3 兼容导入）、migrate.test.ts（MAX(version) 8）。
4. 修正/新增 Web fixture：MonthlyGoal 增 seriesId/occurrenceKey 字段后受影响文件补齐。
## 验收
- 新增用例全部通过;既有用例无回归。
- pnpm typecheck 与 pnpm test（contracts -> server -> web -> 脚本)全绿。
- 更新 .scratch 票据/规格文档以反映差异(如有)。

## Comments

### 2026-08-22 实现摘要

- **服务端测试**（monthly-goals.test.ts 扩为 15 用例）：
  - 系列生成：monthly interval 1 count 3 → occurrenceKeys 2026-08/09/10；quarterly interval 2 until 2027-08 → 08/次年02/次年08；yearly count 3 → 每年 8 月；实例全为模板 title/description、seriesId 一致、status null、未关联。
  - count/until 相交：count 5 + until 2026-11 → 4 期；count 2 + until 2026-12 → 2 期。
  - 拒绝：无结束条件 422（detail 含「必须指定期数或结束月份之一」——fastify AJV 前缀 instancePath，用 toContain）；until 超前 422「结束月份不能早于起始月份」；无界 until 2100-08 超 600 期 422「单次生成的期数不能超过 600」。
  - 实例独立：PATCH 单实例标题/归档不影响系列（instanceCount/template 不变）；PATCH 系列 count 3→5 仅补齐 11/12 期且新期用新模板标题；删除实例后 PATCH 再补齐该期（occurrenceKey 幂等）。
  - 停止：错版 PATCH 409；DELETE 204 后 active=false、实例保留；已停止系列 PATCH 仅改规则（generated 恒 0）；GET 不存在系列 404。
  - 权限：token 与 password editor 均可 POST/GET/PATCH/停止系列（无 admin 限制）。
  - 传输：导出 v4（monthly_goal_series 1 行、monthly_goals 4 行、series_id 对齐、无 tags）；v3 兼容导入（series 清空、goals 去 series 列后保留并全为 seriesId null）；v2/v1 导入后 goals 与 series 全空。
- **Web 测试**（MonthlyGoalsPage.test.tsx 扩为 10 用例）：系列提交 payload 精确断言（template/frequency/interval/startPeriod/occurrenceCount/untilPeriod null）与生成实例渲染 + 徽标出现；徽标 title 摘要；系列对话框编辑规则（PATCH body + version）与停止（确认文案 + 已停止状态）；既有 8 例全部保持（其中「乐观锁冲突」用例同时捕获了 submit() try/catch 丢失回归，已修复）。
- **既有断言更新**：app.test.ts transfer 用例改为 schemaVersion 4（v1 载荷剥 monthly_goal_series）+ migrate.test.ts MAX(version)=8；Web MonthlyGoal fixture 三处补 seriesId/occurrenceKey。
- **验证**：server 75/75；web 146/146；pnpm typecheck 全绿；根级 pnpm test（contracts → server → web → 脚本）全绿。
- **遗留说明**：系列规则支持「频率/间隔/结束条件」，暂不支持模板标题/说明在系列对话框内编辑（后续可在对话框加模板字段）；实例跨期移动后其 occurrence_key 保留原值（避免补期重复，属保守语义）。
