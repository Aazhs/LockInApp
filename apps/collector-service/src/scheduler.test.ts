import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  defaultSchedulerStatePath,
  parseDailyScheduleTime,
  readLastSentUsageDate,
  shouldSendForSchedule,
  writeLastSentUsageDate
} from "./scheduler";

describe("scheduler utils", () => {
  it("parses valid schedule times", () => {
    expect(parseDailyScheduleTime("12:30")).toEqual({
      hour: 12,
      minute: 30,
      label: "12:30"
    });
    expect(parseDailyScheduleTime("7:05")).toEqual({
      hour: 7,
      minute: 5,
      label: "07:05"
    });
  });

  it("throws on invalid schedule times", () => {
    expect(() => parseDailyScheduleTime("24:00")).toThrow();
    expect(() => parseDailyScheduleTime("12:99")).toThrow();
    expect(() => parseDailyScheduleTime("abc")).toThrow();
  });

  it("reads and writes last sent usage date", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lockin-scheduler-"));
    const statePath = path.join(tempDir, "state.json");

    expect(readLastSentUsageDate(statePath)).toBeNull();
    writeLastSentUsageDate(statePath, "2026-04-02");
    expect(readLastSentUsageDate(statePath)).toBe("2026-04-02");
  });

  it("builds default state path from db path", () => {
    const statePath = defaultSchedulerStatePath("/tmp/lockin/usage.sqlite");
    expect(statePath).toBe(path.resolve("/tmp/lockin/.lockin-email-scheduler.json"));
  });

  it("decides if schedule should send", () => {
    const schedule = parseDailyScheduleTime("12:30");
    const due = shouldSendForSchedule(
      new Date("2026-04-03T12:30:00"),
      schedule,
      "2026-04-02",
      "2026-04-01"
    );
    const alreadySent = shouldSendForSchedule(
      new Date("2026-04-03T12:30:00"),
      schedule,
      "2026-04-02",
      "2026-04-02"
    );
    const wrongMinute = shouldSendForSchedule(
      new Date("2026-04-03T12:31:00"),
      schedule,
      "2026-04-02",
      null
    );

    expect(due).toBe(true);
    expect(alreadySent).toBe(false);
    expect(wrongMinute).toBe(false);
  });
});
