import Database from "better-sqlite3";
import {
  BrowserAggregate,
  BrowserName,
  DailySummary,
  DomainAggregate
} from "@lockin/shared";
import { getEventsForUsageDate } from "./db";

function toBrowserAggregate(map: Map<BrowserName, number>): BrowserAggregate[] {
  return [...map.entries()]
    .map(([browser, activeSeconds]) => ({ browser, activeSeconds }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds);
}

function toDomainAggregate(map: Map<string, DomainAggregate>): DomainAggregate[] {
  return [...map.values()]
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, 5);
}

export function buildDailySummary(db: Database.Database, date: string): DailySummary {
  const rows = getEventsForUsageDate(db, date);

  let totalActiveSeconds = 0;
  const browserMap = new Map<BrowserName, number>();
  const domainMap = new Map<string, DomainAggregate>();
  let longestSessionSeconds = 0;
  let longestSessionDomain = "";

  for (const row of rows) {
    totalActiveSeconds += row.active_seconds;

    const browserSeconds = browserMap.get(row.browser) ?? 0;
    browserMap.set(row.browser, browserSeconds + row.active_seconds);

    const currentDomain = domainMap.get(row.domain);
    if (currentDomain) {
      currentDomain.activeSeconds += row.active_seconds;
      currentDomain.visitCount += 1;
    } else {
      domainMap.set(row.domain, {
        domain: row.domain,
        activeSeconds: row.active_seconds,
        visitCount: 1
      });
    }

    if (row.active_seconds > longestSessionSeconds) {
      longestSessionSeconds = row.active_seconds;
      longestSessionDomain = row.domain;
    }
  }

  const topDomains = toDomainAggregate(domainMap);
  const byBrowser = toBrowserAggregate(browserMap);
  const highlights: string[] = [];

  if (topDomains.length > 0) {
    highlights.push(
      `Top site: ${topDomains[0].domain} (${Math.round(topDomains[0].activeSeconds / 60)} min)`
    );
  }

  if (longestSessionSeconds > 0) {
    highlights.push(
      `Longest focus block: ${Math.round(longestSessionSeconds / 60)} min on ${longestSessionDomain}`
    );
  }

  return {
    date,
    totalActiveSeconds,
    sessionsCount: rows.length,
    byBrowser,
    topDomains,
    highlights
  };
}
