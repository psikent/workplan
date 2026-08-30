import { toLocalDateString } from "./format";

// 节假日表接缝：工作日 = 非周六/周日，与服务端 reminders 模块口径一致；后续可替换为按节假日表查询。
const WORKING_DAY_HOLIDAYS: ReadonlySet<string> = new Set();

export function isWorkingDay(date: Date, holidays: ReadonlySet<string> = WORKING_DAY_HOLIDAYS): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5 && !holidays.has(toLocalDateString(date));
}

/** 从 date（不含）往后数 count 个工作日，返回窗口最后一天的日期。 */
export function workingDaysAfter(date: Date, count: number, holidays: ReadonlySet<string> = WORKING_DAY_HOLIDAYS): Date {
  const cursor = new Date(date);
  let remaining = count;
  while (remaining > 0) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}
