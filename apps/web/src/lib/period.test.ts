import { describe, expect, it } from "vitest";
import { rangeOverlapsMonth } from "./period";

function localDateIso(year: number, month: number, day: number, hour = 0): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("rangeOverlapsMonth", () => {
  it("matches a range contained within the month", () => {
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 10), localDateIso(2026, 8, 11), 2026, 8)).toBe(true);
  });

  it("matches both months for a range crossing a month boundary", () => {
    const startAt = localDateIso(2026, 8, 31, 23);
    const endAt = localDateIso(2026, 9, 1, 1);

    expect(rangeOverlapsMonth(startAt, endAt, 2026, 8)).toBe(true);
    expect(rangeOverlapsMonth(startAt, endAt, 2026, 9)).toBe(true);
  });

  it("matches both years for a range crossing December and January", () => {
    const startAt = localDateIso(2026, 12, 31, 23);
    const endAt = localDateIso(2027, 1, 1, 1);

    expect(rangeOverlapsMonth(startAt, endAt, 2026, 12)).toBe(true);
    expect(rangeOverlapsMonth(startAt, endAt, 2027, 1)).toBe(true);
  });

  it("uses half-open boundaries at the start and end of a month", () => {
    const monthStart = localDateIso(2026, 8, 1);
    const nextMonthStart = localDateIso(2026, 9, 1);

    expect(rangeOverlapsMonth(monthStart, nextMonthStart, 2026, 8)).toBe(true);
    expect(rangeOverlapsMonth(localDateIso(2026, 7, 31, 23), monthStart, 2026, 8)).toBe(false);
    expect(rangeOverlapsMonth(nextMonthStart, localDateIso(2026, 9, 1, 1), 2026, 8)).toBe(false);
  });

  it("rejects invalid dates, months, and years", () => {
    expect(rangeOverlapsMonth("not-a-date", localDateIso(2026, 8, 2), 2026, 8)).toBe(false);
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 1), "not-a-date", 2026, 8)).toBe(false);
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 1), localDateIso(2026, 8, 2), 2026, 0)).toBe(false);
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 1), localDateIso(2026, 8, 2), 2026, 13)).toBe(false);
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 1), localDateIso(2026, 8, 2), Number.NaN, 8)).toBe(false);
  });

  it("rejects an empty or reversed range", () => {
    const startAt = localDateIso(2026, 8, 10);
    const endAt = localDateIso(2026, 8, 10);

    expect(rangeOverlapsMonth(startAt, endAt, 2026, 8)).toBe(false);
    expect(rangeOverlapsMonth(localDateIso(2026, 8, 11), startAt, 2026, 8)).toBe(false);
  });
});
