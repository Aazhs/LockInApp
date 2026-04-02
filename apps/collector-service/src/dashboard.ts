import { BrowserName } from "@lockin/shared";
import {
  ClassifierProvider,
  ClassificationSource,
  DomainSeconds,
  extractYoutubeVideoId,
  isYouTubeDomain,
  ManualDomainLabel,
  RowClassification
} from "./classification";
import { UsageEventRow } from "./db";
import {
  getUsageDayWindow,
  USAGE_DAY_END_HOUR,
  USAGE_DAY_START_HOUR,
  usageWindowEndForTimeline
} from "./usage-day";

const TIMELINE_BUCKET_MINUTES = 10;
const TIMELINE_BUCKET_MS = TIMELINE_BUCKET_MINUTES * 60 * 1000;

export interface DashboardTopDomain {
  domain: string;
  activeSeconds: number;
  sessions: number;
}

export interface DashboardBrowserUsage {
  browser: BrowserName;
  activeSeconds: number;
  sessions: number;
}

export interface DashboardTimelinePoint {
  label: string;
  activeSeconds: number;
}

export interface DashboardRecentEvent {
  id: number;
  browser: BrowserName;
  domain: string;
  title: string | null;
  url: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  sessions: number;
  classificationLabel: "good" | "neutral" | "waste";
  classificationReason: string;
  classificationSource: ClassificationSource;
}

export interface DashboardSnapshot {
  date: string;
  generatedAt: string;
  usageDayStartIso: string;
  usageDayEndIso: string;
  usageDayStartHour: number;
  usageDayEndHour: number;
  totalActiveSeconds: number;
  sessionsCount: number;
  uniqueDomains: number;
  uniqueUrls: number;
  byBrowser: DashboardBrowserUsage[];
  topDomains: DashboardTopDomain[];
  timeline: DashboardTimelinePoint[];
  productivity: DashboardProductivitySummary;
  recentEvents: DashboardRecentEvent[];
}

export interface DashboardProductivityDomain {
  domain: string;
  activeSeconds: number;
}

export interface DashboardProductivitySummary {
  provider: ClassifierProvider;
  model: string;
  strategy: string;
  score: number;
  verdict: string;
  goodSeconds: number;
  neutralSeconds: number;
  wasteSeconds: number;
  goodPercent: number;
  neutralPercent: number;
  wastePercent: number;
  topGoodDomains: DashboardProductivityDomain[];
  topWasteDomains: DashboardProductivityDomain[];
  pendingManualDomains: DashboardProductivityDomain[];
  aiEnabled: boolean;
  youtubeClassifiedVideos: number;
  youtubePendingVideos: number;
  manualDomainLabels: Array<{
    domain: string;
    label: "good" | "neutral" | "waste";
  }>;
}

interface BuildDashboardSnapshotInput {
  date: string;
  rows: UsageEventRow[];
  recentLimit: number;
  model: string;
  rowClassifications: Map<number, RowClassification>;
  pendingManualDomains: DomainSeconds[];
  manualDomainLabels: ManualDomainLabel[];
  provider: ClassifierProvider;
  aiEnabled: boolean;
  youtubeClassifiedVideos: number;
  youtubePendingVideos: number;
}

function bucketLabel(ms: number): string {
  const date = new Date(ms);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeBucketMs(ms: number): number {
  return Math.floor(ms / TIMELINE_BUCKET_MS) * TIMELINE_BUCKET_MS;
}

function buildTimeline(date: string, rows: UsageEventRow[], nowMs: number): DashboardTimelinePoint[] {
  const usageWindow = getUsageDayWindow(date);
  const dayStartMs = usageWindow.startMs;
  const dayEndMs = usageWindowEndForTimeline(date, nowMs);
  const buckets = new Map<number, number>();

  for (const row of rows) {
    const startedAtMs = new Date(row.started_at).getTime();
    if (Number.isNaN(startedAtMs)) {
      continue;
    }
    if (startedAtMs < dayStartMs || startedAtMs > dayEndMs) {
      continue;
    }

    const bucketMs = normalizeBucketMs(startedAtMs);
    const seconds = buckets.get(bucketMs) ?? 0;
    buckets.set(bucketMs, seconds + row.active_seconds);
  }

  const timeline: DashboardTimelinePoint[] = [];
  for (
    let bucketMs = normalizeBucketMs(dayStartMs);
    bucketMs <= normalizeBucketMs(dayEndMs);
    bucketMs += TIMELINE_BUCKET_MS
  ) {
    timeline.push({
      label: bucketLabel(bucketMs),
      activeSeconds: buckets.get(bucketMs) ?? 0
    });
  }

  return timeline;
}

function percent(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }

  return Math.round((part / whole) * 100);
}

function scoreVerdict(score: number): string {
  if (score >= 75) {
    return "Great focus";
  }
  if (score >= 60) {
    return "Mostly productive";
  }
  if (score >= 45) {
    return "Mixed usage";
  }
  return "High distraction";
}

function toTopDomains(map: Map<string, number>, size: number): DashboardProductivityDomain[] {
  return [...map.entries()]
    .map(([domain, activeSeconds]) => ({ domain, activeSeconds }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, size);
}

interface RecentEventAggregate {
  id: number;
  browser: BrowserName;
  domain: string;
  title: string | null;
  url: string;
  startedAtMs: number;
  endedAtMs: number;
  activeSeconds: number;
  sessions: number;
  latestStartedAtMs: number;
  classificationLabel: "good" | "neutral" | "waste";
  classificationReason: string;
  classificationSource: ClassificationSource;
}

function rowMs(rawIso: string): number {
  const ms = new Date(rawIso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function recentGroupKey(row: UsageEventRow): string {
  if (isYouTubeDomain(row.domain)) {
    const videoId = extractYoutubeVideoId(row.url);
    if (videoId) {
      return `youtube:${videoId}`;
    }
  }

  return `domain:${row.domain}`;
}

function buildRecentEvents(
  rows: UsageEventRow[],
  rowClassifications: Map<number, RowClassification>,
  recentLimit: number
): DashboardRecentEvent[] {
  const grouped = new Map<string, RecentEventAggregate>();

  for (const row of rows) {
    const key = recentGroupKey(row);
    const startedAtMs = rowMs(row.started_at);
    const endedAtMs = Math.max(rowMs(row.ended_at), startedAtMs + row.active_seconds * 1000);
    const classification = rowClassifications.get(row.id) ?? {
      label: "neutral" as const,
      reason: "Missing classification",
      source: "fallback" as const
    };

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        id: row.id,
        browser: row.browser,
        domain: row.domain,
        title: row.title,
        url: row.url,
        startedAtMs,
        endedAtMs,
        activeSeconds: row.active_seconds,
        sessions: 1,
        latestStartedAtMs: startedAtMs,
        classificationLabel: classification.label,
        classificationReason: classification.reason,
        classificationSource: classification.source
      });
      continue;
    }

    existing.activeSeconds += row.active_seconds;
    existing.sessions += 1;
    existing.startedAtMs = Math.min(existing.startedAtMs, startedAtMs);
    existing.endedAtMs = Math.max(existing.endedAtMs, endedAtMs);
    if (startedAtMs >= existing.latestStartedAtMs) {
      existing.latestStartedAtMs = startedAtMs;
      existing.id = row.id;
      existing.browser = row.browser;
      existing.title = row.title;
      existing.url = row.url;
      existing.classificationLabel = classification.label;
      existing.classificationReason = classification.reason;
      existing.classificationSource = classification.source;
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.endedAtMs - a.endedAtMs)
    .slice(0, recentLimit)
    .map((entry) => ({
      id: entry.id,
      browser: entry.browser,
      domain: entry.domain,
      title: entry.title,
      url: entry.url,
      startedAt: new Date(entry.startedAtMs).toISOString(),
      endedAt: new Date(entry.endedAtMs).toISOString(),
      activeSeconds: entry.activeSeconds,
      sessions: entry.sessions,
      classificationLabel: entry.classificationLabel,
      classificationReason: entry.classificationReason,
      classificationSource: entry.classificationSource
    }));
}

export function buildDashboardSnapshot(input: BuildDashboardSnapshotInput): DashboardSnapshot {
  const {
    date,
    rows,
    recentLimit,
    model,
    rowClassifications,
    pendingManualDomains,
    manualDomainLabels,
    provider,
    aiEnabled,
    youtubeClassifiedVideos,
    youtubePendingVideos
  } = input;
  const nowMs = Date.now();
  const browserMap = new Map<BrowserName, DashboardBrowserUsage>();
  const domainMap = new Map<string, DashboardTopDomain>();
  const goodDomainMap = new Map<string, number>();
  const wasteDomainMap = new Map<string, number>();
  const uniqueUrls = new Set<string>();
  let totalActiveSeconds = 0;
  let goodSeconds = 0;
  let neutralSeconds = 0;
  let wasteSeconds = 0;

  for (const row of rows) {
    totalActiveSeconds += row.active_seconds;
    uniqueUrls.add(row.url);

    const productivity = rowClassifications.get(row.id) ?? {
      label: "neutral",
      reason: "Missing classification",
      source: "fallback"
    };
    if (productivity.label === "good") {
      goodSeconds += row.active_seconds;
      const current = goodDomainMap.get(row.domain) ?? 0;
      goodDomainMap.set(row.domain, current + row.active_seconds);
    } else if (productivity.label === "waste") {
      wasteSeconds += row.active_seconds;
      const current = wasteDomainMap.get(row.domain) ?? 0;
      wasteDomainMap.set(row.domain, current + row.active_seconds);
    } else {
      neutralSeconds += row.active_seconds;
    }

    const browserUsage = browserMap.get(row.browser);
    if (browserUsage) {
      browserUsage.activeSeconds += row.active_seconds;
      browserUsage.sessions += 1;
    } else {
      browserMap.set(row.browser, {
        browser: row.browser,
        activeSeconds: row.active_seconds,
        sessions: 1
      });
    }

    const domainUsage = domainMap.get(row.domain);
    if (domainUsage) {
      domainUsage.activeSeconds += row.active_seconds;
      domainUsage.sessions += 1;
    } else {
      domainMap.set(row.domain, {
        domain: row.domain,
        activeSeconds: row.active_seconds,
        sessions: 1
      });
    }
  }

  const byBrowser = [...browserMap.values()].sort((a, b) => b.activeSeconds - a.activeSeconds);
  const topDomains = [...domainMap.values()]
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, 8);
  const timeline = buildTimeline(date, rows, nowMs);
  const productivityScore =
    totalActiveSeconds === 0
      ? 50
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(((goodSeconds - wasteSeconds) / totalActiveSeconds) * 50 + 50)
          )
        );
  const productivity: DashboardProductivitySummary = {
    provider,
    model,
    strategy:
      "YouTube via AI classification, non-YouTube via manual domain labels, X/Twitter/Reddit forced BAD",
    score: productivityScore,
    verdict: scoreVerdict(productivityScore),
    goodSeconds,
    neutralSeconds,
    wasteSeconds,
    goodPercent: percent(goodSeconds, totalActiveSeconds),
    neutralPercent: percent(neutralSeconds, totalActiveSeconds),
    wastePercent: percent(wasteSeconds, totalActiveSeconds),
    topGoodDomains: toTopDomains(goodDomainMap, 5),
    topWasteDomains: toTopDomains(wasteDomainMap, 5),
    pendingManualDomains: pendingManualDomains.slice(0, 8),
    aiEnabled,
    youtubeClassifiedVideos,
    youtubePendingVideos,
    manualDomainLabels
  };
  const recentEvents = buildRecentEvents(rows, rowClassifications, recentLimit);
  const usageWindow = getUsageDayWindow(date);

  return {
    date,
    generatedAt: new Date(nowMs).toISOString(),
    usageDayStartIso: usageWindow.startIso,
    usageDayEndIso: usageWindow.endIso,
    usageDayStartHour: USAGE_DAY_START_HOUR,
    usageDayEndHour: USAGE_DAY_END_HOUR,
    totalActiveSeconds,
    sessionsCount: rows.length,
    uniqueDomains: domainMap.size,
    uniqueUrls: uniqueUrls.size,
    byBrowser,
    topDomains,
    timeline,
    productivity,
    recentEvents
  };
}
