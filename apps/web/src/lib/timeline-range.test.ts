import { describe, expect, it } from "vitest";
import { shiftTimelineAnchor } from "./timeline-range";

function localDate(year: number, month: number, day: number) {
  return new Date(year, month - 1, day);
}

describe("shiftTimelineAnchor week view", () => {
  it("moves exactly seven local calendar days forward and back", () => {
    expect(shiftTimelineAnchor(localDate(2026, 8, 8), "week", 1)).toEqual(localDate(2026, 8, 15));
    expect(shiftTimelineAnchor(localDate(2026, 8, 8), "week", -1)).toEqual(localDate(2026, 8, 1));
  });

  it("crosses month and year boundaries without skipping a week", () => {
    expect(shiftTimelineAnchor(localDate(2026, 1, 31), "week", 1)).toEqual(localDate(2026, 2, 7));
    expect(shiftTimelineAnchor(localDate(2026, 12, 31), "week", 1)).toEqual(localDate(2027, 1, 7));
    expect(shiftTimelineAnchor(localDate(2027, 1, 3), "week", -1)).toEqual(localDate(2026, 12, 27));
  });

  it("keeps the start of week monotonic around a leap year February", () => {
    // 2028-02-29 是闰年二月最后一天：+7 天必须落在 3 月而不是 2 月。
    expect(shiftTimelineAnchor(localDate(2028, 2, 29), "week", 1)).toEqual(localDate(2028, 3, 7));
    expect(shiftTimelineAnchor(localDate(2028, 3, 7), "week", -1)).toEqual(localDate(2028, 2, 29));
  });
});

describe("shiftTimelineAnchor month view", () => {
  it("lands on the first day of the next month", () => {
    expect(shiftTimelineAnchor(localDate(2026, 8, 8), "month", 1)).toEqual(localDate(2026, 9, 1));
  });

  it("lands on the last day of the previous month", () => {
    expect(shiftTimelineAnchor(localDate(2026, 8, 8), "month", -1)).toEqual(localDate(2026, 7, 31));
  });

  it("never overflows the anchor day-of-month into the month after next", () => {
    // Date.setMonth(±1) 在 31 日会溢出：1月31日+1 曾跳到 3 月，3月31日-1 曾跳过 2 月。
    expect(shiftTimelineAnchor(localDate(2026, 1, 31), "month", 1)).toEqual(localDate(2026, 2, 1));
    expect(shiftTimelineAnchor(localDate(2026, 3, 31), "month", -1)).toEqual(localDate(2026, 2, 28));
    expect(shiftTimelineAnchor(localDate(2026, 5, 31), "month", 1)).toEqual(localDate(2026, 6, 1));
    expect(shiftTimelineAnchor(localDate(2026, 7, 31), "month", -1)).toEqual(localDate(2026, 6, 30));
  });

  it("handles leap year February from both directions", () => {
    expect(shiftTimelineAnchor(localDate(2028, 3, 31), "month", -1)).toEqual(localDate(2028, 2, 29));
    expect(shiftTimelineAnchor(localDate(2028, 1, 31), "month", 1)).toEqual(localDate(2028, 2, 1));
    expect(shiftTimelineAnchor(localDate(2028, 2, 29), "month", 1)).toEqual(localDate(2028, 3, 1));
  });

  it("crosses year boundaries in both directions", () => {
    expect(shiftTimelineAnchor(localDate(2026, 12, 15), "month", 1)).toEqual(localDate(2027, 1, 1));
    expect(shiftTimelineAnchor(localDate(2027, 1, 15), "month", -1)).toEqual(localDate(2026, 12, 31));
  });

  it("returns to the same month when shifting forth and back", () => {
    const forward = shiftTimelineAnchor(localDate(2026, 1, 31), "month", 1);
    const back = shiftTimelineAnchor(forward, "month", -1);
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(0);
  });
});
