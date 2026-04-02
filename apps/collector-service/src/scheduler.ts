import fs from "fs";
import path from "path";

export interface DailyScheduleTime {
  hour: number;
  minute: number;
  label: string;
}

interface SchedulerStateFile {
  lastSentUsageDate?: string;
}

export function parseDailyScheduleTime(rawValue: string | undefined): DailyScheduleTime {
  const text = (rawValue ?? "12:30").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid schedule time "${text}". Use HH:MM in 24-hour format.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid schedule time "${text}". Use HH:MM in 24-hour format.`);
  }

  return {
    hour,
    minute,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  };
}

export function defaultSchedulerStatePath(dbPath: string): string {
  return path.resolve(path.dirname(dbPath), ".lockin-email-scheduler.json");
}

export function readLastSentUsageDate(statePath: string): string | null {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as SchedulerStateFile;
    if (typeof parsed.lastSentUsageDate !== "string" || parsed.lastSentUsageDate.length === 0) {
      return null;
    }
    return parsed.lastSentUsageDate;
  } catch {
    return null;
  }
}

export function writeLastSentUsageDate(statePath: string, usageDate: string): void {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        lastSentUsageDate: usageDate,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

export function shouldSendForSchedule(
  now: Date,
  schedule: DailyScheduleTime,
  targetUsageDate: string,
  lastSentUsageDate: string | null
): boolean {
  if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) {
    return false;
  }
  return lastSentUsageDate !== targetUsageDate;
}
