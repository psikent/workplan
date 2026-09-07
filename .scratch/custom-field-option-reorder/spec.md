# Spec: Custom Field Option Reorder（自定义字段选项重排）

> Status: **已定稿，待批准开发** — 票据索引：01 服务端选项重排端点 | 02 Web 选项编辑器排序交互与保存提交。依赖：02 ← 01。
>
> 决策记录：ADR-0009（单选排序按选项管理顺序）；领域词汇：Option Order（CONTEXT.md）。

## Goal

让管理员在设置页编辑单选/多选自定义字段时调整选项顺序（Option Order）：编辑弹窗内拖拽手柄 + 上移/下移按钮，随「保存字段」提交；服务端新增选项重排端点，一次事务重写 `custom_field_options.sort_order`。顺序变更后立即生效于选项下拉/筛选、甘特属性、导出显示，以及单选字段的计划排序。

## Terms

See `CONTEXT.md`: **Custom Field**, **Option Order (选项顺序)**, **Administrator**. ADR-0009 记录了单选排序依据管理顺序的决策与理由。

## Background facts

- 选项编辑器 `apps/web/src/pages/settings/CustomFieldsSettings.tsx:281-303`（OptionEditor）每行只有改名输入框与移除/恢复按钮，**没有任何排序控件**；字段列表（同文件 `:261-274`）已有拖拽手柄 + 上移/下移按钮的双通道模式（dnd-kit `PointerSensor` + `arrayMove`），可复用为交互范式。
- 保存流程：弹窗是草稿态，点「保存字段」时 `syncOptions`（`:161-177`）按差异调 `POST /custom-fields/:id/options`（新增）与 `PATCH /custom-field-options/:id`（改标签/归档）；**顺序从不提交**——`updateCustomFieldOptionSchema`（`packages/contracts/src/index.ts:624-628`）只收 label/archived/version。
- 服务端 `addOption`（`apps/server/src/modules/custom-fields.ts:211-226`）固定追加末尾（`sort_order = 选项数`）；字段级重排端点已存在：`POST /api/v1/custom-fields/reorder`（`routes/custom-fields.ts:35-43`，body `{ orderedIds }`，事务重写 sort_order，无版本校验，最后写入胜出）——选项级端点可直接镜像。
- 服务端所有读取按 `sort_order` 返回选项（`custom-fields.ts:60-62`），因此重排保存后**无需额外改动**即影响：计划编辑抽屉下拉、列表筛选、甘特属性、导出。
- 计划排序：single_select 按选项 `sort_order`（`work-plan-query.ts:375-382`）；排序 JOIN **不滤归档**，归档选项的 sort_order 仍决定持有其历史值的计划的排序位置。
- `custom_field_options` 表无 created_at/updated_at，仅有 version（`db/migrate.ts:32`）。
- 环境配置包：选项仅导出 `{value, label}`（`env-config.ts:50-53`），同步导入的选项差异（`planOptionDiff`，`:312-330`）只比对增删与标签，**不比对也不更新顺序**——手动重排不随包迁移（已知限制，Out of scope）。
- 触发事件：2026-09-07 生产「备注」（remarks，single_select）选项顺序与标签编号不一致导致计划排序疑问，已直接改生产库 `sort_order` 临时修复（1.值班/2.休假/3.出差/4.自动化/5.网络安全）。本特性补上正规的排序通道。

## Requirements

### R1 服务端重排端点
- `POST /api/v1/custom-fields/:id/options/reorder`，body `{ orderedIds: string[] }`（uuid、min 1），鉴权 admin（与既有字段变更一致）。
- `orderedIds` 必须恰好覆盖该字段的**全部**选项 id（活动 + 归档），多一项、缺一项或含他字段 id 均为 422（invalidInput）；字段不存在 404。
- 事务内按数组位置重写 `sort_order = 0..n-1`；不动 version、不写归档位；无版本冲突校验（镜像字段 reorder 的最后写入胜出语义）。返回更新后的字段定义（含选项）。

### R2 编辑器排序交互（草稿态）
- OptionEditor 每行：左侧拖拽手柄（dnd-kit，PointerSensor 配置与字段列表一致），右侧现有移除按钮旁加上移/下移按钮（首行/末行对应禁用）；上移/下移在整个列表（含归档行）内逐位交换。
- 活动行与归档行统一可排序（归档选项的顺序位影响历史值计划的排序，ADR-0009）。
- 拖动/移动只改弹窗草稿数组顺序，不发起任何 API 调用；行 key 用 `option.id ?? option.value` 保持稳定。

### R3 保存提交
- 点「保存字段」：既有字段更新与 `syncOptions`（含新增选项 POST 拿回 id）完成后，若草稿的选项 id 序列与字段当前顺序不同，则调 R1 端点一次，`orderedIds` 为全部选项 id（含归档与本次新建）。
- 任一步失败走现有 `setError` 展示；取消/关闭弹窗不提交任何变更。

### R4 生效范围（回归确认，无新改动）
- 保存后下拉、筛选、甘特属性、导出、single_select 计划排序按新顺序返回（服务端读取已按 sort_order）。

### R5 测试
- 服务端：happy path（含归档选项参与重排）、缺项/多项/跨字段 id 422、字段不存在 404、非 admin 拒绝、重排后 list 顺序正确、事务原子。
- Web：手柄与上下移按钮渲染、边界禁用、拖拽换序、保存时顺序未变不调 reorder、变化时恰好调一次且含新选项 id、取消不调、归档行可移动。

## 验收标准（Acceptance criteria）

1. 设置页编辑任一单选/多选字段，拖动手柄或点上移/下移可调整选项顺序（归档行同样可调），未保存前关闭弹窗顺序不变。
2. 点「保存字段」后重新打开或刷新，选项保持新顺序；计划编辑抽屉下拉与按该单选字段排序的计划列表顺序一致地变化。
3. 重排端点拒绝不完整 id 列表（422）与非 admin 调用；多管理员并发重排为最后写入胜出，不产生半套顺序（事务原子）。
4. 环境与回归：`pnpm typecheck` 与 `pnpm test`（server + web 相关）全绿；既有自定义字段用例零回归。

## Out of scope
- 环境配置包携带/同步选项顺序（包格式演进，另立票据）。
- multi_select 字段参与计划排序（维持不支持，见 `SORT_UNSUPPORTED_TYPES`）。
- 「按标签文字排序」的单选排序模式（ADR-0009 已拒绝）。
- 新增选项的默认插入位（维持追加末尾，重排即可整理）。
