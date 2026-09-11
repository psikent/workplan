# 01 — 全候选冲突预览契约与服务端
Type: task
Status: resolved
Spec: ../spec.md
Scope: packages/contracts、apps/server/src/modules/owner-conflicts.ts、Work Plan service/routes、server/contracts tests、docs/adr/0008

## 背景

现有 `/work-plans/conflict-check` 一次只能检查已选中的一个 owner，且假设目标恒为 `in_progress`。下拉预标记需要一次返回当前草稿时段内所有 owner 的冲突清单，并正确尊重当前草稿的 automatic/manual 有效状态。

## 改动清单

1. 新增 strict 的 conflict-preview 请求/响应契约，形状按规格 R2；复用 `OwnerConflictCounterpart`，约束 owner 分组唯一、稳定排序和合法 ISO 时间。
2. 将 Owner Conflict 核心整理为可同时服务持久化全局标记、单 owner 校核和全 owner 草稿预览的共同逻辑，保持半开区间、trim、活跃状态及 Counterpart 顺序不变。
3. 按请求 `statusMode` 计算草稿有效状态：automatic 以单一 `evaluatedAt` 派生，manual 使用 status；非活跃草稿直接返回空分组。
4. 编辑传 id 时排除自身；只评估当前 Occurrence，不读取或展开 Recurring Series。
5. 增加 `POST /work-plans/conflict-preview` 查询路由；从全库读取最小投影并一次分组计算，不受列表查询范围/筛选/分页影响，无写入副作用。
6. 保留既有 conflict-check 行为和公开契约，避免无关破坏。
7. 增加契约、纯函数与路由集成测试：多 owner、多 Counterpart、端点相接、毫秒重叠、空 owner、different owner、排除自身、automatic/manual 四状态、未来系列不展开、非法输入和 Viewer 查询权限。

## 验收

- 规格验收标准 2–4、8 中的服务端部分全部通过。
- 单次请求即可得到所有冲突 owner 分组，不出现逐候选查询或客户端当前页推算。

## Answer

已完成：新增 strict `workPlanConflictPreviewRequest/Response` 契约、`POST /api/v1/work-plans/conflict-preview` 查询路由、全候选服务端计算及 automatic/manual 草稿状态处理；编辑按 id 排除自身，非活跃草稿返回空分组，既有 `conflict-check` 保持兼容。补充了契约、纯函数和路由集成测试。

验证证据（2026-09-10）：contracts 25/25、server 定向冲突测试 41/41、server 全套 235/235、web 全套 337/337、脚本 46/46（9 个平台跳过项）；全仓 typecheck 通过；代码审查未发现 P0/P1。

## Comments

- 票据 02 负责把预览响应接入负责人下拉选项和抽屉状态机；票据 03 负责真实浏览器验收。二者未随本票实现。
