import Database from "better-sqlite3";
import { BrowserName, UsageEvent } from "@lockin/shared";
import { getUsageDayWindow } from "./usage-day";

export type ProductivityLabel = "good" | "neutral" | "waste";

export interface UsageEventRow {
  id: number;
  browser: BrowserName;
  url: string;
  domain: string;
  title: string | null;
  started_at: string;
  ended_at: string;
  active_seconds: number;
  is_focused: number;
  source_tab_id: number | null;
}

export interface ManualDomainLabelRow {
  domain: string;
  label: ProductivityLabel;
  updated_at: string;
}

export interface YoutubeVideoLabelRow {
  video_id: string;
  label: ProductivityLabel;
  reason: string | null;
  confidence: number | null;
  source: string;
  model: string | null;
  title: string | null;
  url: string | null;
  updated_at: string;
}

const CREATE_EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  browser TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  active_seconds INTEGER NOT NULL CHECK(active_seconds >= 0),
  is_focused INTEGER NOT NULL CHECK(is_focused IN (0, 1)),
  source_tab_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_usage_events_started_at ON usage_events(started_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_domain ON usage_events(domain);
CREATE INDEX IF NOT EXISTS idx_usage_events_browser ON usage_events(browser);
`;

const CREATE_CLASSIFICATION_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS manual_domain_labels (
  domain TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK(label IN ('good', 'neutral', 'waste')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS youtube_video_labels (
  video_id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK(label IN ('good', 'neutral', 'waste')),
  reason TEXT,
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'openai',
  model TEXT,
  title TEXT,
  url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS youtube_video_ai_attempts (
  video_id TEXT PRIMARY KEY,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const CREATE_CLASSIFICATION_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_manual_domain_labels_label ON manual_domain_labels(label);
CREATE INDEX IF NOT EXISTS idx_youtube_video_labels_label ON youtube_video_labels(label);
CREATE INDEX IF NOT EXISTS idx_youtube_video_ai_attempts_attempted_at ON youtube_video_ai_attempts(attempted_at);
`;

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  initializeSchema(db);
  return db;
}

export function initializeSchema(db: Database.Database): void {
  db.exec(CREATE_EVENTS_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);
  db.exec(CREATE_CLASSIFICATION_TABLES_SQL);
  db.exec(CREATE_CLASSIFICATION_INDEX_SQL);
}

export function insertUsageEvent(db: Database.Database, event: UsageEvent): number {
  const insert = db.prepare(
    `INSERT INTO usage_events (
      browser,
      url,
      domain,
      title,
      started_at,
      ended_at,
      active_seconds,
      is_focused,
      source_tab_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const result = insert.run(
    event.browser,
    event.url,
    event.domain,
    event.title ?? null,
    event.startedAt,
    event.endedAt,
    event.activeSeconds,
    event.isFocused ? 1 : 0,
    event.sourceTabId ?? null
  );

  return Number(result.lastInsertRowid);
}

export function getEventsForUsageDate(db: Database.Database, date: string): UsageEventRow[] {
  const window = getUsageDayWindow(date);
  const query = db.prepare<{
    startIso: string;
    endIso: string;
  }, UsageEventRow>(
    `SELECT
      id,
      browser,
      url,
      domain,
      title,
      started_at,
      ended_at,
      active_seconds,
      is_focused,
      source_tab_id
     FROM usage_events
     WHERE started_at >= @startIso
       AND started_at < @endIso`
  );

  return query.all({
    startIso: window.startIso,
    endIso: window.endIso
  });
}

export function getEventsForIsoRange(
  db: Database.Database,
  startIso: string,
  endIso: string
): UsageEventRow[] {
  const query = db.prepare<{ startIso: string; endIso: string }, UsageEventRow>(
    `SELECT
      id,
      browser,
      url,
      domain,
      title,
      started_at,
      ended_at,
      active_seconds,
      is_focused,
      source_tab_id
     FROM usage_events
     WHERE started_at >= @startIso
       AND started_at < @endIso`
  );

  return query.all({
    startIso,
    endIso
  });
}

export function listManualDomainLabels(db: Database.Database): ManualDomainLabelRow[] {
  const query = db.prepare<[], ManualDomainLabelRow>(
    `SELECT domain, label, updated_at
     FROM manual_domain_labels
     ORDER BY domain ASC`
  );
  return query.all();
}

export function getManualDomainLabels(db: Database.Database): Map<string, ProductivityLabel> {
  const rows = listManualDomainLabels(db);
  return new Map(rows.map((row) => [row.domain, row.label]));
}

export function upsertManualDomainLabel(
  db: Database.Database,
  domain: string,
  label: ProductivityLabel
): void {
  const query = db.prepare(
    `INSERT INTO manual_domain_labels (domain, label, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(domain) DO UPDATE SET
       label = excluded.label,
       updated_at = datetime('now')`
  );

  query.run(domain, label);
}

export function deleteManualDomainLabel(db: Database.Database, domain: string): number {
  const query = db.prepare(`DELETE FROM manual_domain_labels WHERE domain = ?`);
  const result = query.run(domain);
  return result.changes;
}

export function getYoutubeVideoLabels(
  db: Database.Database,
  videoIds: string[]
): Map<string, YoutubeVideoLabelRow> {
  if (videoIds.length === 0) {
    return new Map();
  }

  const placeholders = videoIds.map(() => "?").join(", ");
  const query = db.prepare<unknown[], YoutubeVideoLabelRow>(
    `SELECT
      video_id,
      label,
      reason,
      confidence,
      source,
      model,
      title,
      url,
      updated_at
     FROM youtube_video_labels
     WHERE video_id IN (${placeholders})`
  );

  const rows = query.all(...videoIds);
  return new Map(rows.map((row) => [row.video_id, row]));
}

export interface UpsertYoutubeVideoLabelInput {
  videoId: string;
  label: ProductivityLabel;
  reason?: string;
  confidence?: number;
  source: string;
  model?: string;
  title?: string;
  url?: string;
}

export function upsertYoutubeVideoLabel(
  db: Database.Database,
  input: UpsertYoutubeVideoLabelInput
): void {
  const query = db.prepare(
    `INSERT INTO youtube_video_labels (
      video_id,
      label,
      reason,
      confidence,
      source,
      model,
      title,
      url,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(video_id) DO UPDATE SET
      label = excluded.label,
      reason = excluded.reason,
      confidence = excluded.confidence,
      source = excluded.source,
      model = excluded.model,
      title = excluded.title,
      url = excluded.url,
      updated_at = datetime('now')`
  );

  query.run(
    input.videoId,
    input.label,
    input.reason ?? null,
    input.confidence ?? null,
    input.source,
    input.model ?? null,
    input.title ?? null,
    input.url ?? null
  );
}

export function getYoutubeVideoAiAttemptedIds(
  db: Database.Database,
  videoIds: string[],
  retryAfterIso?: string
): Set<string> {
  if (videoIds.length === 0) {
    return new Set();
  }

  const placeholders = videoIds.map(() => "?").join(", ");
  const retryFilter =
    typeof retryAfterIso === "string" && retryAfterIso.length > 0
      ? "AND attempted_at >= ?"
      : "";
  const query = db.prepare<unknown[], { video_id: string }>(
    `SELECT video_id
     FROM youtube_video_ai_attempts
     WHERE video_id IN (${placeholders})
     ${retryFilter}`
  );

  const rows =
    typeof retryAfterIso === "string" && retryAfterIso.length > 0
      ? query.all(...videoIds, retryAfterIso)
      : query.all(...videoIds);
  return new Set(rows.map((row) => row.video_id));
}

export function markYoutubeVideoAiAttempted(db: Database.Database, videoId: string): void {
  const query = db.prepare(
    `INSERT INTO youtube_video_ai_attempts (video_id, attempted_at)
     VALUES (?, datetime('now'))
     ON CONFLICT(video_id) DO UPDATE SET
       attempted_at = datetime('now')`
  );

  query.run(videoId);
}
