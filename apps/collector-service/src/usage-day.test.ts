import { describe, expect, it } from "vitest";
import {
  currentUsageDate,
  getUsageDayWindow,
  latestCompletedUsageDate,
  usageDateForTimestamp
} from "./usage-day";

describe("usage-day", () => {
  it("builds 6:00 -> 2:00 usage day window", () => {
    const window = getUsageDayWindow("2026-04-01");
    const start = new Date(window.startIso);
    const end = new Date(window.endIso);

    expect(start.getHours()).toBe(6);
    expect(end.getHours()).toBe(2);
    expect(end.getDate()).not.toBe(start.getDate());
  });

  it("maps timestamps to usage dates with 2:00-5:59 excluded", () => {
    const lateNight = new Date(2026, 3, 2, 1, 30, 0, 0);
    const offHours = new Date(2026, 3, 2, 3, 10, 0, 0);
    const morning = new Date(2026, 3, 2, 8, 45, 0, 0);

    expect(usageDateForTimestamp(lateNight)).toBe("2026-04-01");
    expect(usageDateForTimestamp(offHours)).toBeNull();
    expect(usageDateForTimestamp(morning)).toBe("2026-04-02");
  });

  it("defaults current usage date to previous date before 6 AM", () => {
    const beforeStart = new Date(2026, 3, 2, 5, 30, 0, 0);
    const afterStart = new Date(2026, 3, 2, 6, 30, 0, 0);

    expect(currentUsageDate(beforeStart)).toBe("2026-04-01");
    expect(currentUsageDate(afterStart)).toBe("2026-04-02");
  });

  it("resolves latest completed usage date correctly around 2 AM", () => {
    const beforeEnd = new Date(2026, 3, 2, 1, 40, 0, 0);
    const afterEnd = new Date(2026, 3, 2, 2, 40, 0, 0);
    const midday = new Date(2026, 3, 2, 12, 30, 0, 0);

    expect(latestCompletedUsageDate(beforeEnd)).toBe("2026-03-31");
    expect(latestCompletedUsageDate(afterEnd)).toBe("2026-04-01");
    expect(latestCompletedUsageDate(midday)).toBe("2026-04-01");
  });
});
