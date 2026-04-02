import express from "express";
import cors from "cors";
import path from "path";
import Database from "better-sqlite3";
import { normalizeDomain, UsageEvent } from "@lockin/shared";
import {
  ClassifierProvider,
  isForcedBadDomain,
  isYouTubeDomain,
  resolveClassifications
} from "./classification";
import {
  deleteManualDomainLabel,
  getEventsForIsoRange,
  getEventsForUsageDate,
  insertUsageEvent,
  listManualDomainLabels,
  upsertManualDomainLabel
} from "./db";
import { buildDashboardSnapshot } from "./dashboard";
import { manualDomainLabelInputSchema, usageEventInputSchema } from "./validation";
import {
  addUsageDays,
  currentUsageDate,
  getUsageDayWindow,
  USAGE_DAY_END_HOUR,
  USAGE_DAY_START_HOUR,
  usageDateForTimestamp
} from "./usage-day";

function parseDateQuery(rawDate: unknown): string | null {
  if (typeof rawDate !== "string") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return null;
  }

  const parsed = new Date(`${rawDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return rawDate;
}

function parseLimitQuery(rawLimit: unknown): number {
  if (typeof rawLimit !== "string") {
    return 120;
  }

  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    return 120;
  }

  return Math.max(10, Math.min(5000, Math.trunc(parsed)));
}

function parseDaysQuery(rawDays: unknown): number {
  if (typeof rawDays !== "string") {
    return 14;
  }

  const parsed = Number(rawDays);
  if (!Number.isFinite(parsed)) {
    return 14;
  }

  return Math.max(3, Math.min(60, Math.trunc(parsed)));
}

function normalizeManualDomainInput(rawDomain: string): string | null {
  const trimmed = rawDomain.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  let domain = trimmed;
  try {
    if (trimmed.includes("://")) {
      domain = new URL(trimmed).hostname.toLowerCase();
    } else if (
      trimmed.includes("/") ||
      trimmed.includes("?") ||
      trimmed.includes("#") ||
      trimmed.includes(":")
    ) {
      domain = new URL(`https://${trimmed}`).hostname.toLowerCase();
    }
  } catch {
    return null;
  }

  domain = domain.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    return null;
  }

  if (
    domain.length === 0 ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return null;
  }

  return domain;
}

export interface ServerOptions {
  provider?: ClassifierProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

export function createServer(db: Database.Database, options: ServerOptions = {}) {
  const app = express();
  const dashboardStaticDir = path.resolve(__dirname, "../public");

  app.use(cors());
  app.use(express.json({ limit: "64kb" }));
  app.use("/dashboard", express.static(dashboardStaticDir));

  app.get("/", (_req, res) => {
    res.redirect("/dashboard");
  });

  app.get("/v1/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/v1/dashboard", (req, res) => {
    void (async () => {
      const date = parseDateQuery(req.query.date) ?? currentUsageDate(new Date());
      const limit = parseLimitQuery(req.query.limit);
      const rows = getEventsForUsageDate(db, date);
      const classifications = await resolveClassifications({
        db,
        rows,
        provider: options.provider,
        openaiApiKey: options.openaiApiKey,
        openaiModel: options.openaiModel,
        geminiApiKey: options.geminiApiKey,
        geminiModel: options.geminiModel
      });
      const snapshot = buildDashboardSnapshot({
        date,
        rows,
        recentLimit: limit,
        model: classifications.model,
        rowClassifications: classifications.rowMap,
        pendingManualDomains: classifications.pendingManualDomains,
        manualDomainLabels: classifications.manualDomainLabels,
        provider: classifications.provider,
        aiEnabled: classifications.aiEnabled,
        youtubeClassifiedVideos: classifications.youtubeClassifiedVideos,
        youtubePendingVideos: classifications.youtubePendingVideos
      });
      return res.status(200).json({ ok: true, data: snapshot });
    })().catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      return res.status(500).json({ ok: false, error: "Failed to build dashboard snapshot" });
    });
  });

  app.get("/v1/dashboard/history", (req, res) => {
    const endDate = parseDateQuery(req.query.endDate) ?? currentUsageDate(new Date());
    const days = parseDaysQuery(req.query.days);
    const startDate = addUsageDays(endDate, -(days - 1));
    const startWindow = getUsageDayWindow(startDate);
    const endWindow = getUsageDayWindow(endDate);
    const rows = getEventsForIsoRange(db, startWindow.startIso, endWindow.endIso);

    const totalsByDate = new Map<
      string,
      { totalActiveSeconds: number; sessionsCount: number; uniqueDomains: Set<string> }
    >();

    for (const row of rows) {
      const usageDate = usageDateForTimestamp(new Date(row.started_at));
      if (!usageDate) {
        continue;
      }
      if (usageDate < startDate || usageDate > endDate) {
        continue;
      }

      const existing = totalsByDate.get(usageDate);
      if (existing) {
        existing.totalActiveSeconds += row.active_seconds;
        existing.sessionsCount += 1;
        existing.uniqueDomains.add(row.domain);
      } else {
        totalsByDate.set(usageDate, {
          totalActiveSeconds: row.active_seconds,
          sessionsCount: 1,
          uniqueDomains: new Set([row.domain])
        });
      }
    }

    const items = Array.from({ length: days }, (_unused, index) => {
      const date = addUsageDays(startDate, index);
      const summary = totalsByDate.get(date);
      return {
        date,
        totalActiveSeconds: summary?.totalActiveSeconds ?? 0,
        sessionsCount: summary?.sessionsCount ?? 0,
        uniqueDomains: summary?.uniqueDomains.size ?? 0
      };
    });

    return res.status(200).json({
      ok: true,
      data: {
        startDate,
        endDate,
        days,
        windowStartHour: USAGE_DAY_START_HOUR,
        windowEndHour: USAGE_DAY_END_HOUR,
        items
      }
    });
  });

  app.get("/v1/classification/manual-domains", (_req, res) => {
    const rows = listManualDomainLabels(db);
    return res.status(200).json({ ok: true, data: rows });
  });

  app.post("/v1/classification/manual-domains", (req, res) => {
    const parsed = manualDomainLabelInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid payload",
        issues: parsed.error.issues
      });
    }

    const normalizedDomain = normalizeManualDomainInput(parsed.data.domain);
    if (!normalizedDomain) {
      return res.status(400).json({
        ok: false,
        error: "Invalid domain"
      });
    }

    if (isYouTubeDomain(normalizedDomain)) {
      return res.status(400).json({
        ok: false,
        error: "YouTube is AI-classified only. Manual labels are disabled."
      });
    }

    if (isForcedBadDomain(normalizedDomain)) {
      return res.status(400).json({
        ok: false,
        error: "This domain is forced BAD by policy and cannot be overridden."
      });
    }

    upsertManualDomainLabel(db, normalizedDomain, parsed.data.label);
    return res.status(201).json({
      ok: true,
      data: {
        domain: normalizedDomain,
        label: parsed.data.label
      }
    });
  });

  app.delete("/v1/classification/manual-domains/:domain", (req, res) => {
    let rawDomain = "";
    try {
      rawDomain = decodeURIComponent(req.params.domain ?? "");
    } catch {
      return res.status(400).json({
        ok: false,
        error: "Invalid domain encoding"
      });
    }
    const normalizedDomain = normalizeManualDomainInput(rawDomain);
    if (!normalizedDomain) {
      return res.status(400).json({
        ok: false,
        error: "Invalid domain"
      });
    }

    const deleted = deleteManualDomainLabel(db, normalizedDomain);
    return res.status(200).json({
      ok: true,
      removed: deleted > 0
    });
  });

  app.post("/v1/events", (req, res) => {
    const parsed = usageEventInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid payload",
        issues: parsed.error.issues
      });
    }

    const domain = normalizeDomain(parsed.data.url);
    if (!domain) {
      return res.status(202).json({
        ok: true,
        ignored: true,
        reason: "Untrackable URL"
      });
    }

    const event: UsageEvent = {
      ...parsed.data,
      domain
    };

    if (event.endedAt < event.startedAt) {
      return res.status(400).json({
        ok: false,
        error: "endedAt must be greater than or equal to startedAt"
      });
    }

    const id = insertUsageEvent(db, event);
    return res.status(201).json({ ok: true, id });
  });

  return app;
}
