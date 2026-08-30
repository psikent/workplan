import { describe, expect, it } from "vitest";
import { isWorkingDay, workingDaysAfter } from "./working-days";

describe("isWorkingDay", () => {
  it("counts weekdays as working days", () => {
    expect(isWorkingDay(new Date(2026, 7, 31))).toBe(true); // 周一
    expect(isWorkingDay(new Date(2026, 8, 4))).toBe(true); // 周五
  });

  it("excludes Saturday and Sunday", () => {
    expect(isWorkingDay(new Date(2026, 8, 5))).toBe(false); // 周六
    expect(isWorkingDay(new Date(2026, 8, 6))).toBe(false); // 周日
  });

  it("expects dates in the holiday seam set to be non-working", () => {
    const holidays = new Set(["2026-10-01"]);
    expect(isWorkingDay(new Date(2026, 9, 1), holidays)).toBe(false);
    expect(isWorkingDay(new Date(2026, 9, 1))).toBe(true);
  });
});

describe("workingDaysAfter", () => {
  it("returns the next working day from a weekday", () => {
    expect(workingDaysAfter(new Date(2026, 7, 31), 1)).toEqual(new Date(2026, 8, 1));
  });

  it("skips the weekend when counting from Friday", () => {
    expect(workingDaysAfter(new Date(2026, 8, 4), 1)).toEqual(new Date(2026, 8, 7));
  });

  it("counts exactly seven working days across weekends", () => {
    // 2026-08-31 是周一：7 个工作日窗口到 2026-09-09（周三）。
    expect(workingDaysAfter(new Date(2026, 7, 31), 7)).toEqual(new Date(2026, 8, 9));
  });
});
