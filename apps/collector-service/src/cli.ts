import { generateAiDailySummary } from "./ai-summary";
import { resolveClassifications } from "./classification";
import { loadConfig } from "./config";
import { buildDashboardSnapshot } from "./dashboard";
import { getEventsForUsageDate, openDatabase } from "./db";
import { sendEmailReport } from "./email";
import { formatAccountabilityEmailHtml, formatAccountabilityMessage } from "./formatter";
import {
  defaultSchedulerStatePath,
  parseDailyScheduleTime,
  readLastSentUsageDate,
  shouldSendForSchedule,
  writeLastSentUsageDate
} from "./scheduler";
import { latestCompletedUsageDate } from "./usage-day";

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function toMinutes(seconds: number): number {
  const rounded = Math.round(seconds / 60);
  if (seconds > 0 && rounded <= 0) {
    return 1;
  }
  return rounded;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePollSeconds(rawValue: string | undefined): number {
  const parsed = Number(rawValue ?? "30");
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(5, Math.min(300, Math.trunc(parsed)));
}

function isSevereWasteDay(input: {
  totalActiveSeconds: number;
  wasteSeconds: number;
  wastePercent: number;
}): boolean {
  const totalMinutes = toMinutes(input.totalActiveSeconds);
  const wasteMinutes = toMinutes(input.wasteSeconds);
  return totalMinutes >= 360 && wasteMinutes >= 150 && input.wastePercent >= 45;
}

async function runSummary(input: { date: string; shouldSend: boolean }) {
  const { date, shouldSend } = input;
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const rows = getEventsForUsageDate(db, date);
  const classifications = await resolveClassifications({
    db,
    rows,
    provider: config.classifierProvider,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.openaiModel,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel
  });
  const snapshot = buildDashboardSnapshot({
    date,
    rows,
    recentLimit: 8,
    model: classifications.model,
    rowClassifications: classifications.rowMap,
    pendingManualDomains: classifications.pendingManualDomains,
    manualDomainLabels: classifications.manualDomainLabels,
    provider: classifications.provider,
    aiEnabled: classifications.aiEnabled,
    youtubeClassifiedVideos: classifications.youtubeClassifiedVideos,
    youtubePendingVideos: classifications.youtubePendingVideos
  });
  const severeWasteDay = isSevereWasteDay({
    totalActiveSeconds: snapshot.totalActiveSeconds,
    wasteSeconds: snapshot.productivity.wasteSeconds,
    wastePercent: snapshot.productivity.wastePercent
  });
  const aiSummary = await generateAiDailySummary({
    provider: config.classifierProvider,
    openaiApiKey: config.openaiApiKey,
    openaiModel: config.openaiModel,
    geminiApiKey: config.geminiApiKey,
    geminiModel: config.geminiModel,
    summary: {
      date,
      totalMinutes: toMinutes(snapshot.totalActiveSeconds),
      goodMinutes: toMinutes(snapshot.productivity.goodSeconds),
      neutralMinutes: toMinutes(snapshot.productivity.neutralSeconds),
      wasteMinutes: toMinutes(snapshot.productivity.wasteSeconds),
      goodPercent: snapshot.productivity.goodPercent,
      neutralPercent: snapshot.productivity.neutralPercent,
      wastePercent: snapshot.productivity.wastePercent,
      topGood: snapshot.productivity.topGoodDomains.slice(0, 3).map((item) => ({
        name: item.domain,
        minutes: toMinutes(item.activeSeconds)
      })),
      topWaste: snapshot.productivity.topWasteDomains.slice(0, 3).map((item) => ({
        name: item.domain,
        minutes: toMinutes(item.activeSeconds)
      })),
      recentActivities: snapshot.recentEvents.slice(0, 5).map((item) => {
        const title = item.title?.trim() ? item.title : item.domain;
        return `${title} (${item.domain}) ${toMinutes(item.activeSeconds)}m`;
      }),
      severeWasteDay
    }
  });
  const message = formatAccountabilityMessage({
    date,
    snapshot,
    aiSummary,
    severeWasteDay
  });
  const htmlMessage = formatAccountabilityEmailHtml({
    date,
    snapshot,
    aiSummary,
    severeWasteDay
  });

  // eslint-disable-next-line no-console
  console.log(message);

  if (!shouldSend) {
    return;
  }

  if (!config.emailTo) {
    throw new Error("Missing EMAIL_TO environment variable.");
  }

  const sendResult = await sendEmailReport(
    {
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      user: config.smtpUser,
      pass: config.smtpPass,
      from: config.smtpFrom
    },
    {
      to: config.emailTo,
      subject: `LockIn Daily Accountability Report (${date})`,
      textBody: message,
      htmlBody: htmlMessage
    }
  );

  if (!sendResult.ok) {
    throw new Error(sendResult.error);
  }

  // eslint-disable-next-line no-console
  console.log(`Email sent successfully: ${sendResult.messageId ?? "no-id-returned"}`);
}

async function summarizeCommand() {
  const date = getFlag("--date") ?? latestCompletedUsageDate(new Date());
  const shouldSend = hasFlag("--send");
  await runSummary({ date, shouldSend });
}

async function scheduleCommand() {
  const config = loadConfig();
  const schedule = parseDailyScheduleTime(
    getFlag("--time") ?? process.env.EMAIL_SCHEDULE_TIME ?? "12:30"
  );
  const pollSeconds = parsePollSeconds(
    getFlag("--poll-seconds") ?? process.env.EMAIL_SCHEDULE_POLL_SECONDS
  );
  const statePath =
    getFlag("--state-file") ??
    process.env.EMAIL_SCHEDULE_STATE_PATH ??
    defaultSchedulerStatePath(config.dbPath);

  let lastSentUsageDate = readLastSentUsageDate(statePath);

  // eslint-disable-next-line no-console
  console.log(
    `Email scheduler started. send_time=${schedule.label}, poll=${pollSeconds}s, state=${statePath}`
  );

  // eslint-disable-next-line no-console
  console.log("Press Ctrl+C to stop.");

  while (true) {
    const now = new Date();
    const targetUsageDate = latestCompletedUsageDate(now);

    if (shouldSendForSchedule(now, schedule, targetUsageDate, lastSentUsageDate)) {
      // eslint-disable-next-line no-console
      console.log(`Scheduler trigger at ${now.toISOString()} for usage date ${targetUsageDate}`);
      try {
        await runSummary({
          date: targetUsageDate,
          shouldSend: true
        });
        writeLastSentUsageDate(statePath, targetUsageDate);
        lastSentUsageDate = targetUsageDate;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Scheduled send failed:", error);
      }
    }

    await sleep(pollSeconds * 1000);
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "summarize") {
    await summarizeCommand();
    return;
  }

  if (command === "schedule") {
    await scheduleCommand();
    return;
  }

  if (command !== "summarize" && command !== "schedule") {
    // eslint-disable-next-line no-console
    console.error(
      "Usage: npm run summarize -- [--date YYYY-MM-DD] [--send] OR npm run schedule -- [--time HH:MM] [--poll-seconds N] [--state-file PATH]"
    );
    process.exit(1);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
