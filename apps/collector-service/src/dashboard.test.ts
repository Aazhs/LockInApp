import { afterEach, describe, expect, it, vi } from "vitest";
import { RowClassification } from "./classification";
import { buildDashboardSnapshot } from "./dashboard";
import { UsageEventRow } from "./db";

function localIso(year: number, monthIndex: number, day: number, hour: number, minute: number): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

describe("buildDashboardSnapshot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds totals, rankings, timeline and recent events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 31, 23, 30, 0, 0));

    const rows: UsageEventRow[] = [
      {
        id: 1,
        browser: "zen",
        url: "https://github.com",
        domain: "github.com",
        title: "GitHub",
        started_at: localIso(2026, 2, 31, 9, 0),
        ended_at: localIso(2026, 2, 31, 9, 10),
        active_seconds: 600,
        is_focused: 1,
        source_tab_id: 11
      },
      {
        id: 2,
        browser: "zen",
        url: "https://x.com/home",
        domain: "x.com",
        title: "X",
        started_at: localIso(2026, 2, 31, 10, 0),
        ended_at: localIso(2026, 2, 31, 10, 4),
        active_seconds: 240,
        is_focused: 1,
        source_tab_id: 12
      },
      {
        id: 3,
        browser: "safari",
        url: "https://github.com/issues",
        domain: "github.com",
        title: "Issues",
        started_at: localIso(2026, 2, 31, 10, 30),
        ended_at: localIso(2026, 2, 31, 10, 33),
        active_seconds: 180,
        is_focused: 1,
        source_tab_id: 13
      }
    ];
    const rowClassifications = new Map<number, RowClassification>([
      [1, { label: "good", reason: "manual", source: "manual" }],
      [2, { label: "waste", reason: "forced", source: "forced" }],
      [3, { label: "good", reason: "manual", source: "manual" }]
    ]);

    const snapshot = buildDashboardSnapshot({
      date: "2026-03-31",
      rows,
      recentLimit: 2,
      provider: "gemini",
      model: "gemini-1.5-flash",
      rowClassifications,
      pendingManualDomains: [{ domain: "example.com", activeSeconds: 50 }],
      manualDomainLabels: [{ domain: "github.com", label: "good" }],
      aiEnabled: true,
      youtubeClassifiedVideos: 2,
      youtubePendingVideos: 1
    });

    expect(snapshot.totalActiveSeconds).toBe(1020);
    expect(snapshot.sessionsCount).toBe(3);
    expect(snapshot.uniqueDomains).toBe(2);
    expect(snapshot.uniqueUrls).toBe(3);
    expect(snapshot.byBrowser).toEqual([
      { browser: "zen", activeSeconds: 840, sessions: 2 },
      { browser: "safari", activeSeconds: 180, sessions: 1 }
    ]);
    expect(snapshot.topDomains[0]).toEqual({
      domain: "github.com",
      activeSeconds: 780,
      sessions: 2
    });
    expect(snapshot.recentEvents).toHaveLength(2);
    expect(snapshot.recentEvents[0].id).toBe(3);
    expect(snapshot.recentEvents[1].id).toBe(2);
    expect(snapshot.recentEvents[0].activeSeconds).toBe(780);
    expect(snapshot.recentEvents[0].sessions).toBe(2);
    expect(snapshot.recentEvents[0].classificationLabel).toBe("good");
    expect(snapshot.recentEvents[1].activeSeconds).toBe(240);
    expect(snapshot.recentEvents[1].sessions).toBe(1);
    expect(snapshot.recentEvents[1].classificationLabel).toBe("waste");
    expect(snapshot.productivity.provider).toBe("gemini");
    expect(snapshot.productivity.model).toBe("gemini-1.5-flash");
    expect(snapshot.productivity.goodSeconds).toBe(780);
    expect(snapshot.productivity.neutralSeconds).toBe(0);
    expect(snapshot.productivity.wasteSeconds).toBe(240);
    expect(snapshot.productivity.score).toBeGreaterThan(70);
    expect(snapshot.productivity.pendingManualDomains).toEqual([
      { domain: "example.com", activeSeconds: 50 }
    ]);
    expect(snapshot.productivity.aiEnabled).toBe(true);
    expect(snapshot.productivity.youtubeClassifiedVideos).toBe(2);
    expect(snapshot.productivity.youtubePendingVideos).toBe(1);
    expect(snapshot.productivity.manualDomainLabels).toEqual([
      { domain: "github.com", label: "good" }
    ]);

    const timelineTotalSeconds = snapshot.timeline.reduce(
      (total, point) => total + point.activeSeconds,
      0
    );
    expect(timelineTotalSeconds).toBe(1020);
  });
});
