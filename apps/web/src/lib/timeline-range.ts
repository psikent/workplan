export type TimelineView = "week" | "month";

/**
 * 日历安全的范围锚点移动（spec R1/D11）。
 *
 * 周视图严格前后移动 7 个本地日历日；月视图严格进入相邻自然月。两者都不复用原锚点的
 * 日号，因此 1 月 31 日、3 月 31 日、闰年二月与跨年都不会因 `Date.setMonth` 的溢出
 * 跳过目标范围。月视图前进落在目标月第一天、后退落在目标月最后一天，保持时间连续性。
 * 时间部分统一归零：锚点只承载日历范围，可见范围始终由 startOfWeek/startOfMonth 派生。
 */
export function shiftTimelineAnchor(anchor: Date, view: TimelineView, direction: -1 | 1): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  if (view === "week") return new Date(year, month, anchor.getDate() + 7 * direction);
  return direction > 0 ? new Date(year, month + 1, 1) : new Date(year, month, 0);
}
