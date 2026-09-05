import type { OwnerConflict, OwnerConflictCounterpart, WorkPlanStatus } from "@workplan/contracts";

// 冲突判定的输入投影（规格 R1/R2）：同 owner、[startAt, endAt) 半开精确相交、
// 双方活跃（pending/in_progress）。status 进入投影是为了让全部判定语义收敛在
// 本纯函数内——调用方（SQL 投影）无需复刻活跃条件的派生规则。
export type OwnerConflictItem = {
  id: string;
  label: string;
  owner: string;
  startAt: string;
  endAt: string;
  status: WorkPlanStatus;
};

const ACTIVE_CONFLICT_STATUSES: ReadonlySet<WorkPlanStatus> = new Set(["pending", "in_progress"]);

// 实时校核（R3）假设目标的投影占位 id：只作映射键，绝不落入任何响应。
const CONFLICT_CHECK_TARGET_ID = "__conflict-check-target__";

// 半开相交：毫秒级精确时刻；端点相接（前一段的 endAt === 后一段的 startAt）不算冲突。
function overlaps(left: Pick<OwnerConflictItem, "startAt" | "endAt">, right: Pick<OwnerConflictItem, "startAt" | "endAt">): boolean {
  return Date.parse(left.startAt) < Date.parse(right.endAt) && Date.parse(right.startAt) < Date.parse(left.endAt);
}

// 全局冲突计算（规格 R2）：按 owner 值分组、组内按 startAt 排序后扫描重叠对，
// 输出 id → ownerConflict 映射；成对关系，不做连通分量聚类。
// 复杂度 O(n log n)（n 为活跃且 owner 非空的任务数），团队量级数百条，开销可忽略。
export function computeOwnerConflicts(items: OwnerConflictItem[]): Map<string, OwnerConflict> {
  const groups = new Map<string, OwnerConflictItem[]>();
  for (const item of items) {
    // 空 owner（未指派）与 completed/cancelled 不参与冲突。
    if (!item.owner || !ACTIVE_CONFLICT_STATUSES.has(item.status)) continue;
    const group = groups.get(item.owner);
    if (group) group.push(item);
    else groups.set(item.owner, [item]);
  }

  const result = new Map<string, OwnerConflict>();
  for (const group of groups.values()) {
    group.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
    for (let left = 0; left < group.length; left++) {
      const earlier = group[left]!;
      for (let right = left + 1; right < group.length; right++) {
        const later = group[right]!;
        // 组内按 startAt 升序：首个不与 earlier 相交的项之后均更晚，可提前结束。
        if (!overlaps(earlier, later)) break;
        pushPair(result, earlier, later);
        pushPair(result, later, earlier);
      }
    }
  }
  for (const entry of result.values()) {
    entry.counterparts.sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || left.id.localeCompare(right.id));
  }
  return result;
}

function pushPair(map: Map<string, OwnerConflict>, plan: OwnerConflictItem, counterpart: OwnerConflictItem): void {
  const entry = map.get(plan.id) ?? { owner: plan.owner, counterparts: [] as OwnerConflictCounterpart[] };
  entry.counterparts.push({ id: counterpart.id, label: counterpart.label, startAt: counterpart.startAt, endAt: counterpart.endAt });
  map.set(plan.id, entry);
}

// 实时校核（规格 R3）：给定假设的 owner + 区间，复用同一判定函数返回冲突对象清单。
// 假设目标以占位投影参与计算；excludeId 排除编辑中的任务自身（其库内记录与本假设
// 区间必然相交，否则会被误报为自身冲突）。
export function conflictCounterpartsFor(
  target: { owner: string; startAt: string; endAt: string },
  items: OwnerConflictItem[],
  excludeId?: string,
): OwnerConflictCounterpart[] {
  if (!target.owner) return [];
  const projection = excludeId ? items.filter((item) => item.id !== excludeId) : items;
  const withTarget: OwnerConflictItem[] = [
    ...projection,
    { id: CONFLICT_CHECK_TARGET_ID, label: "", owner: target.owner, startAt: target.startAt, endAt: target.endAt, status: "in_progress" },
  ];
  return computeOwnerConflicts(withTarget).get(CONFLICT_CHECK_TARGET_ID)?.counterparts ?? [];
}
