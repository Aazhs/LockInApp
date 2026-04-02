import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { UsageEvent } from "@lockin/shared";
import { buildDailySummary } from "./summary";
import { initializeSchema, insertUsageEvent } from "./db";

function createEvent(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    browser: "zen",
    url: "https://example.com",
    domain: "example.com",
    startedAt: "2026-03-31T12:00:00.000Z",
    endedAt: "2026-03-31T12:01:00.000Z",
    activeSeconds: 60,
    isFocused: true,
    ...overrides
  };
}

describe("buildDailySummary", () => {
  it("aggregates totals and top domains", () => {
    const db = new Database(":memory:");
    initializeSchema(db);

    insertUsageEvent(
      db,
      createEvent({
        browser: "zen",
        url: "https://github.com",
        domain: "github.com",
        activeSeconds: 120
      })
    );
    insertUsageEvent(
      db,
      createEvent({
        browser: "safari",
        url: "https://youtube.com",
        domain: "youtube.com",
        activeSeconds: 180
      })
    );
    insertUsageEvent(
      db,
      createEvent({
        browser: "zen",
        url: "https://github.com/issues",
        domain: "github.com",
        activeSeconds: 30
      })
    );

    const summary = buildDailySummary(db, "2026-03-31");
    expect(summary.totalActiveSeconds).toBe(330);
    expect(summary.sessionsCount).toBe(3);
    expect(summary.topDomains[0]).toMatchObject({
      domain: "youtube.com",
      activeSeconds: 180,
      visitCount: 1
    });
    expect(summary.byBrowser).toEqual([
      { browser: "safari", activeSeconds: 180 },
      { browser: "zen", activeSeconds: 150 }
    ]);
  });
});
