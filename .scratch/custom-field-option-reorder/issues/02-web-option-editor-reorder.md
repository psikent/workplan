# 02 — Web：选项编辑器排序交互与保存提交
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/settings/CustomFieldsSettings.tsx（OptionEditor、submit/syncOptions）、apps/web 测试

## 背景

规格 R2/R3。OptionEditor（`CustomFieldsSettings.tsx:281-303`）现仅改名/移除；同文件字段列表（`:261-274`）已有拖拽手柄 + 上移/下移按钮的双通道模式可复用（dnd-kit `DndContext`/`SortableContext`/`arrayMove`，PointerSensor）。弹窗为草稿态：label/归档改动在点「保存字段」时经 `syncOptions`（`:161-177`）按差异提交，顺序需沿用同一时机。

## 改动清单

1. OptionEditor 行内排序控件：
   - 左侧拖拽手柄（GripVertical，`useSortable`，key 用 `option.id ?? option.value`）；DndContext/SortableContext 由 OptionEditor 自建（弹窗内独立于页面级字段列表的 DndContext），PointerSensor 配置与字段列表一致；
   - 右侧移除按钮旁加上移/下移 icon-button（首行/末行对应禁用），在整个列表（含归档行）内逐位交换；
   - 活动与归档行统一可排序；所有移动只改草稿数组，不发 API。
2. submit 流程扩展：
   - 现有字段更新与 `syncOptions` 完成后（新增选项 POST 需拿回 id），比较草稿选项 id 序列与 `field.options` 原序（归档选项含在内）；
   - 不同则调 `POST /custom-fields/:id/options/reorder`（orderedIds = 全部选项 id，含归档与本次新建），失败走现有 `setError`；
   - 取消/关闭弹窗不触发任何提交。
3. 测试（组件级）：
   - 手柄与上下移按钮渲染、首末行禁用、归档行可移动；
   - 拖拽/按钮换序改草稿顺序；
   - 保存时顺序未变 → 不调 reorder；顺序变化 → 恰好调一次且 orderedIds 含新建选项 id；取消 → 不调；
   - 既有字段编辑保存用例零回归。

## 验收

- 与规格 R2/R3/验收标准 1-2 一致：编辑弹窗可拖/可移（含归档行），保存后顺序持久，下拉与单选计划排序随之变化，取消不变。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。

## Answer

已完成（本次会话实现，代码审核通过；P1 并发边界已修复）。

改动：
- `apps/web/src/pages/settings/CustomFieldsSettings.tsx`
  - OptionEditor 自建 DndContext + SortableContext（与页面级字段列表同款 PointerSensor 配置）；每行新增 `SortableOptionRow`：拖拽手柄（GripVertical/field-sort-handle）+ 上移/下移 icon-button（首末行禁用）+ 既有移除/恢复按钮；归档行同样可排；行 key `option.id ?? option.value`；所有移动仅改草稿，零 API 调用。
  - `syncOptions` 重写为返回与草稿对齐的选项 id 序列（新建选项取 POST 响应 id；跳过行不计入），语义与原差异提交等价。
  - 新增 `syncOptionOrder`：草稿顺序与弹窗打开时原序一致直接跳过（审核 P1 修复——并发新增选项时保存不再被重排 422 中断，也省去每次保存的全量 GET）；确有移动时与保存后的 fresh 顺序比较，有变化才 POST 一次 `/options/reorder`（orderedIds 含归档与新建）。失败经 mutateAsync → setError 展示，取消零提交。
- `apps/web/src/styles.css`：`.option-row` 网格 28px 手柄 + 输入 + 3 按钮；审核 P3 修复——`.option-row-actions` 显式 `grid-column: 3 / -1; justify-content: flex-end`。
- `apps/web/src/pages/settings/CustomFieldsSettings.test.tsx`：新增 4 例——边界禁用与归档行可排、草稿移动 + 保存恰好一次 reorder（含归档行 id）、顺序未变不调 reorder、取消零写调用。旧字段用例因列表新增 fixtures 修正了字段下移的预期序列。

验收：`pnpm typecheck` 全绿；web 测试 300 例全过（含新增 4 例，CustomFieldsSettings 7/7）。全量 `pnpm test` 绿。
