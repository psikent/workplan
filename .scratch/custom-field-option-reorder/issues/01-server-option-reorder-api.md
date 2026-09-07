# 01 — 服务端：选项重排端点
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/server/src/modules/custom-fields.ts、apps/server/src/routes/custom-fields.ts、apps/server/test/*

## 背景

规格 R1。字段级重排已存在（`POST /api/v1/custom-fields/reorder`，`routes/custom-fields.ts:35-43`，`reorder()` 在 `custom-fields.ts:204-209` 事务重写 sort_order），选项级无对应端点；`updateCustomFieldOptionSchema` 只收 label/archived/version，顺序无法提交。表结构：`custom_field_options` 无 created_at/updated_at，仅 version（`db/migrate.ts:32`）。

## 改动清单

1. `CustomFieldService.reorderOptions(fieldId, orderedIds)`：
   - 字段不存在 → `notFound("自定义字段不存在")`；
   - `orderedIds`（去重后）必须与该字段全部选项 id 集合（活动 + 归档）完全一致，否则 `invalidInput`（422，信息点明"必须覆盖该字段全部选项，含已归档"）；
   - 事务内按数组位置执行 `UPDATE custom_field_options SET sort_order = ? WHERE id = ?`（0..n-1）；不动 version 与归档位；
   - 返回更新后的字段定义（含选项），复用 `list(true)` 查找。
2. 路由 `POST /api/v1/custom-fields/:id/options/reorder`：`config: { authorization: "admin" }`，body `{ orderedIds: z.array(z.string().uuid()).min(1) }`（镜像字段 reorder 的内联 zod，不入 contracts）。
3. 测试（沿用既有 server 测试风格）：
   - happy path：3 个选项 + 1 个归档选项全量提交新顺序，list 返回顺序正确，version 不变；
   - 缺一个 id / 多一个未知 id / 含他字段选项 id → 422；
   - 字段不存在 → 404；非 admin（Editor/Viewer token）→ 拒绝；
   - id 列表含重复 → 422；
   - 重排仅写 sort_order：归档位与既有计划值不受影响。

## 验收

- 与规格 R1/验收标准 3 一致：不完整列表拒绝、并发最后写入胜出、事务原子（中途失败不落半套顺序）。
- `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 全绿，既有用例零回归。

## Answer

已完成（本次会话实现，代码审核通过）。

改动：
- `apps/server/src/modules/custom-fields.ts`：新增 `reorderOptions(fieldId, orderedIds)`——字段不存在 404；orderedIds 经"长度相等 + 去重相等 + 全部属于该字段"三重校验（鸽笼推导为精确全覆盖，含归档），不满足 422；事务内 `UPDATE custom_field_options SET sort_order = 0..n-1`，不动 version 与归档位；返回更新后的字段定义。
- `apps/server/src/routes/custom-fields.ts`：`POST /api/v1/custom-fields/:id/options/reorder`，内联 zod `{ orderedIds: uuid[] min 1 }`，`config: { authorization: "admin" }`（镜像字段 reorder）。
- `apps/server/test/custom-field-option-reorder.test.ts`（新）：6 例——含归档选项的全量重排（顺序/标签/归档位/version 保持断言）、缺 id 422、未知 id 与跨字段 id 422、重复 id 422、字段不存在 404、editor 403。
- `apps/server/test/viewer-authorization.test.ts`：admin-only 请求清单补入新端点。

验收：`pnpm typecheck` 全绿；server 测试 195 例全过（含新增 6 例）。
