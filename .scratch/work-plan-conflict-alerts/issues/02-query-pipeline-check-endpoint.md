# 02 — 查询管道集成与实时校核端点
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/server/src/modules/work-plan-query.ts、apps/server 路由与测试

## 背景

规格 R2/R3。把 01 的纯函数接入查询管道,让每条响应携带全局冲突标记;并给抽屉实时校核提供无副作用端点。

## 改动清单

1. **查询管道集成**(`work-plan-query.ts`):每次 `/work-plans/query` 执行全局冲突计算——取全部活跃且 owner 非空任务的最小投影(可一次轻量 SQL),调用 `owner-conflicts` 纯函数,`serializeRow` 时附加 `ownerConflict`(无冲突为 null)。计算与请求的范围/筛选/分页无关。
2. **实时校核端点** `POST /work-plans/conflict-check`(路径前缀随现有 v1 约定):
   - 入参 `{ id?, owner, startAt, endAt }`;`id` 非空时从结果排除自身;
   - 出参为 counterparts 清单(形状同响应字段);
   - 复用同一冲突判定函数;不落库、无副作用;权限同查询端点;
   - 最小入参校验:owner 非空、起止合法(`endAt > startAt`)。
3. **服务端集成测试**:
   - 范围筛选/状态筛选/分页不影响冲突标记(冲突对象在视野外或被筛掉,任务本身仍标记);
   - `conflict-check` 排除 `id` 自身;`owner` 空或区间非法时 4xx。

## 验收

- 规格验收标准 2;服务端测试全绿;typecheck 通过。
