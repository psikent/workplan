# 03 — 年度快速编辑回归与浏览器验收
Type: task
Status: ready-for-agent
Blocked by: 01, 02
Spec: ../spec.md
Scope: apps/server/test/monthly-goals.test.ts、apps/web/src/pages/MonthlyGoalsPage.test.tsx、apps/web/src/components/MonthlyGoalQuickEditDialog.test.tsx、apps/web/src/styles.css、全仓验证

## 背景

规格 R8 与验收标准。年度快速编辑同时覆盖分组、归档、恢复、系列实例、计划关联、乐观锁和宽表布局；单元测试通过后仍需在真实浏览器中验证保存结果和溢出行为。

## 改动清单

1. 复核并补齐 Contracts/Server 场景：
   - 非法年份、空名称、最终同名、重复或越界月份、无月份新行；
   - 创建缺失月份、同名同月多实例、全年归档行恢复；
   - 活跃/归档混合单元格未变化时保持原状；
   - 全年重命名、两行互换名称、重命名与归档合并更新；
   - 说明、Goal-Plan Link、系列属性、系列模板和其他年份保持；
   - baseline 版本变化、并发新增、并发删除及事务回滚；
   - Administrator、Editor、Token-only Editor 权限。
2. 复核并补齐 Web 场景：入口、年份继承、年度请求、稳定排序、归档空行、同名分组、一个空白初始行、加减行、校验、无变化保存禁用、脏数据确认、payload、成功关闭、普通错误、409 保留草稿及确认重载。
3. 使用一次性数据完成真实浏览器验收：
   - 新增两行并跨多月勾选；
   - 重开后取消勾选、恢复和整行改名；
   - 逐月确认保存结果，并核对说明、工作计划关联和系列标识未变化；
   - 验证关闭/切年确认与冲突恢复可见反馈。
4. 在桌面与窄屏检查全屏弹窗、横向滚动、sticky 名称列、表头/底部操作区、纵向溢出、键盘标签和可访问名称。
5. 验收数据使用唯一名称且不接触正式数据；完成后清理一次性目标和计划并记录清理结果。
6. 运行专项与全量验证，检查仅包含本功能范围内改动；全部通过后才在各票据追加 `## Answer` 并将状态改为 `resolved`。

## 验收

- 规格 R1–R8 与七条总体验收标准均有自动化或浏览器证据。
- 批量保存原子且并发安全，失败时不存在部分写入。
- 归档、恢复和改名不会破坏说明、计划关联、系列实例或其他年份。
- 全屏表格在桌面与窄屏真实渲染中没有不可操作的横向/纵向溢出。
- 以下命令全部通过：
  - `corepack pnpm --filter @workplan/contracts build`
  - `corepack pnpm --filter @workplan/server test -- monthly-goals.test.ts`
  - `corepack pnpm --filter @workplan/web test -- MonthlyGoalsPage.test.tsx MonthlyGoalQuickEditDialog.test.tsx`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm build`
  - `git diff --check`

## Comments

- 本票只收口测试和验收，不扩展到说明、关联、重复规则、永久删除、导入导出或数据库迁移。
