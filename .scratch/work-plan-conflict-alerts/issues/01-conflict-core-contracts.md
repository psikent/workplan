# 01 — 冲突判定核心与契约
Type: task
Status: ready-for-agent
Spec: ../spec.md
Scope: packages/contracts/src/index.ts、apps/server/src/modules/owner-conflicts.ts(新)、CONTEXT.md、docs/adr/

## 背景

规格 R1/R2 的判定语义与契约层。冲突判定是纯函数:同 owner、`[startAt, endAt)` 半开精确相交、双方活跃(`pending`/`in_progress`)、成对不传递。

## 改动清单

1. **contracts**(`packages/contracts/src/index.ts`):
   - 响应侧新增派生只读字段 `ownerConflict`(对象或 null,见规格 R2 形状);创建/更新入参剥离或忽略该字段。
2. **服务端纯函数模块** `apps/server/src/modules/owner-conflicts.ts`:
   - 输入:活跃且 owner 非空任务的最小投影 `{ id, label, owner, startAt, endAt }`;
   - 按 owner 值分组、组内按 `startAt` 排序扫描重叠对,输出 `id → counterparts[]` 映射;counterparts 按 `startAt` 升序;
   - 不做连通分量聚类(成对关系)。
3. **单元测试**(服务端):边界覆盖——端点相接不算冲突(前一 `endAt` === 后一 `startAt`)、毫秒级相交、`completed`/`cancelled` 排除、空 owner 排除、A-B-C 传递链不聚类、同 owner 多任务两两清单正确。
4. **CONTEXT.md** 词汇表登记:Owner Conflict(负责人时段冲突)、Counterpart(冲突对象)。
5. **ADR** `docs/adr/0008-server-derived-owner-conflict.md`:记录「冲突标记由服务端全局计算、随查询响应派生返回」的决策及盲区理由(前端按范围/筛选/分页查询,客户端计算会漏报)。

## 验收

- 规格验收标准 1 的语义全部有测试覆盖;契约字段仅响应侧可出、入参不可写;全仓 typecheck 通过。
