export const USAGE_DAY_START_HOUR = 6;
export const USAGE_DAY_END_HOUR = 2;

export interface UsageDayWindow {
  date: string;
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
}

export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addUsageDays(date: string, delta: number): string {
  const base = new Date(`${date}T00:00:00`);
  base.setDate(base.getDate() + delta);
  return localDateString(base);
}

export function getUsageDayWindow(date: string): UsageDayWindow {
  const start = new Date(`${date}T00:00:00`);
  start.setHours(USAGE_DAY_START_HOUR, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(USAGE_DAY_END_HOUR, 0, 0, 0);

  return {
    date,
    startMs: start.getTime(),
    endMs: end.getTime(),
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

export function currentUsageDate(now: Date): string {
  const today = localDateString(now);
  if (now.getHours() < USAGE_DAY_START_HOUR) {
    return addUsageDays(today, -1);
  }
  return today;
}

export function latestCompletedUsageDate(now: Date): string {
  const today = localDateString(now);
  if (now.getHours() < USAGE_DAY_END_HOUR) {
    return addUsageDays(today, -2);
  }
  return addUsageDays(today, -1);
}

export function usageDateForTimestamp(value: Date): string | null {
  const hour = value.getHours();
  const date = localDateString(value);

  if (hour >= USAGE_DAY_START_HOUR) {
    return date;
  }
  if (hour < USAGE_DAY_END_HOUR) {
    return addUsageDays(date, -1);
  }
  return null;
}

export function usageWindowEndForTimeline(date: string, nowMs: number): number {
  const window = getUsageDayWindow(date);
  if (nowMs <= window.startMs) {
    return window.startMs;
  }
  if (nowMs >= window.endMs) {
    return window.endMs;
  }
  return nowMs;
}
