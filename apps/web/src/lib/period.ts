function localMonthStart(year: number, month: number): Date | null {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) return null;

  const monthStart = new Date(0);
  monthStart.setFullYear(year, month - 1, 1);
  monthStart.setHours(0, 0, 0, 0);

  if (!Number.isFinite(monthStart.getTime()) || monthStart.getFullYear() !== year || monthStart.getMonth() !== month - 1 || monthStart.getDate() !== 1) return null;
  return monthStart;
}

export function rangeOverlapsMonth(startAt: string, endAt: string, year: number, month: number): boolean {
  const monthStart = localMonthStart(year, month);
  if (!monthStart) return false;

  const nextMonthStart = new Date(monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
  if (!Number.isFinite(nextMonthStart.getTime())) return false;

  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;

  return start < nextMonthStart && end > monthStart;
}
