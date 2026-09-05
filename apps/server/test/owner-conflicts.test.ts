import { describe, expect, it } from "vitest";
import { computeOwnerConflicts, conflictCounterpartsFor, type OwnerConflictItem } from "../src/modules/owner-conflicts.js";

const item = (overrides: Partial<OwnerConflictItem> & { id: string }): OwnerConflictItem => ({
  label: `任务 ${overrides.id}`,
  owner: "张三",
  startAt: "2026-05-01T02:00:00.000Z",
  endAt: "2026-05-01T06:00:00.000Z",
  status: "pending",
  ...overrides,
});

const counterpartIds = (entry: { counterparts: Array<{ id: string }> } | undefined) =>
  entry?.counterparts.map((counterpart) => counterpart.id) ?? [];

describe("computeOwnerConflicts（冲突判定语义，规格 R1）", () => {
  it("同 owner 区间相交的活跃任务互为冲突对象，清单按开始时间升序", () => {
    const map = computeOwnerConflicts([
      item({ id: "b", startAt: "2026-05-01T04:00:00.000Z" }),
      item({ id: "a", startAt: "2026-05-01T02:00:00.000Z" }),
      item({ id: "c", startAt: "2026-05-01T03:00:00.000Z", endAt: "2026-05-01T05:00:00.000Z" }),
    ]);
    expect(counterpartIds(map.get("a"))).toEqual(["c", "b"]);
    expect(counterpartIds(map.get("b"))).toEqual(["a", "c"]);
    expect(counterpartIds(map.get("c"))).toEqual(["a", "b"]);
    expect(map.get("a")?.owner).toBe("张三");
    expect(map.get("a")?.counterparts[0]).toEqual({
      id: "c",
      label: "任务 c",
      startAt: "2026-05-01T03:00:00.000Z",
      endAt: "2026-05-01T05:00:00.000Z",
    });
  });

  it("端点相接不算冲突（前一 endAt === 后一 startAt）", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", endAt: "2026-05-01T06:00:00.000Z" }),
      item({ id: "b", startAt: "2026-05-01T06:00:00.000Z", endAt: "2026-05-01T08:00:00.000Z" }),
    ]);
    expect(map.size).toBe(0);
  });

  it("毫秒级相交即冲突", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", endAt: "2026-05-01T06:00:00.000Z" }),
      item({ id: "b", startAt: "2026-05-01T05:59:59.999Z" }),
    ]);
    expect(counterpartIds(map.get("a"))).toEqual(["b"]);
    expect(counterpartIds(map.get("b"))).toEqual(["a"]);
  });

  it("completed 与 cancelled 不参与冲突", () => {
    const map = computeOwnerConflicts([
      item({ id: "a" }),
      item({ id: "done", status: "completed" }),
      item({ id: "void", status: "cancelled" }),
    ]);
    expect(map.size).toBe(0);
  });

  it("空 owner（未指派）不与任何任务冲突，即便区间完全相同", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", owner: "" }),
      item({ id: "b", owner: "" }),
      item({ id: "c", owner: "张三" }),
    ]);
    expect(map.size).toBe(0);
  });

  it("不同 owner 不冲突", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", owner: "张三" }),
      item({ id: "b", owner: "李四" }),
    ]);
    expect(map.size).toBe(0);
  });

  it("A-B-C 传递链不聚类：A-C 不重叠时互不在对方清单", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T04:00:00.000Z" }),
      item({ id: "b", startAt: "2026-05-01T03:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" }),
      item({ id: "c", startAt: "2026-05-01T05:00:00.000Z", endAt: "2026-05-01T07:00:00.000Z" }),
    ]);
    expect(counterpartIds(map.get("a"))).toEqual(["b"]);
    expect(counterpartIds(map.get("b"))).toEqual(["a", "c"]);
    expect(counterpartIds(map.get("c"))).toEqual(["b"]);
  });

  it("不同 owner 的同值判定互不干扰：同名清单只含本组任务", () => {
    const map = computeOwnerConflicts([
      item({ id: "a", owner: "张三", startAt: "2026-05-01T02:00:00.000Z" }),
      item({ id: "b", owner: "张三", startAt: "2026-05-01T03:00:00.000Z" }),
      item({ id: "c", owner: "李四", startAt: "2026-05-01T02:00:00.000Z" }),
      item({ id: "d", owner: "李四", startAt: "2026-05-01T03:00:00.000Z" }),
    ]);
    expect(counterpartIds(map.get("a"))).toEqual(["b"]);
    expect(counterpartIds(map.get("c"))).toEqual(["d"]);
  });
});

describe("conflictCounterpartsFor（实时校核核心，规格 R3）", () => {
  it("返回与给定 owner + 区间相交的活跃任务，排除 excludeId 自身", () => {
    const items = [
      item({ id: "self", startAt: "2026-05-01T02:00:00.000Z" }),
      item({ id: "b", startAt: "2026-05-01T04:00:00.000Z" }),
      item({ id: "far", startAt: "2026-05-09T02:00:00.000Z" }),
    ];
    const counterparts = conflictCounterpartsFor(
      { owner: "张三", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" },
      items,
      "self",
    );
    expect(counterpartIds({ counterparts })).toEqual(["b"]);
    // 不排除自身时，库内的自身记录与假设区间相撞，必须出现在清单里由调用方排除。
    const withoutExclude = conflictCounterpartsFor(
      { owner: "张三", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" },
      items,
    );
    expect(counterpartIds({ counterparts: withoutExclude })).toEqual(["self", "b"]);
  });

  it("假设区间端点相接与 completed 对象都不返回", () => {
    const items = [
      item({ id: "adjacent", startAt: "2026-05-01T06:00:00.000Z", endAt: "2026-05-01T08:00:00.000Z" }),
      item({ id: "done", status: "completed" }),
    ];
    const counterparts = conflictCounterpartsFor(
      { owner: "张三", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" },
      items,
    );
    expect(counterparts).toEqual([]);
  });

  it("owner 为空直接返回空清单", () => {
    expect(conflictCounterpartsFor({ owner: "", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" }, [item({ id: "a" })])).toEqual([]);
  });
});
