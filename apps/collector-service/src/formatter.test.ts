import { describe, expect, it } from "vitest";
import { DailySummary } from "@lockin/shared";
import {
  FormatAccountabilityMessageInput,
  formatAccountabilityEmailHtml,
  formatAccountabilityMessage,
  formatSummaryMessage
} from "./formatter";

describe("formatSummaryMessage", () => {
  it("formats readable summary text", () => {
    const summary: DailySummary = {
      date: "2026-03-31",
      totalActiveSeconds: 3600,
      sessionsCount: 12,
      byBrowser: [
        { browser: "zen", activeSeconds: 2400 },
        { browser: "safari", activeSeconds: 1200 }
      ],
      topDomains: [
        { domain: "github.com", activeSeconds: 1200, visitCount: 4 },
        { domain: "youtube.com", activeSeconds: 900, visitCount: 3 }
      ],
      highlights: ["Top site: github.com (20 min)"]
    };

    const text = formatSummaryMessage(summary);
    expect(text).toContain("Daily web usage summary (2026-03-31)");
    expect(text).toContain("Total active time: 60 min");
    expect(text).toContain("github.com: 20m");
  });

  it("formats accountability message with productivity and AI summary", () => {
    const text = formatAccountabilityMessage({
      date: "2026-04-01",
      severeWasteDay: true,
      aiSummary: "You did some good coding work, but distraction is too high. Block social feeds tomorrow.",
      snapshot: {
        date: "2026-04-01",
        generatedAt: "2026-04-02T07:30:00.000Z",
        usageDayStartIso: "2026-04-01T06:00:00.000Z",
        usageDayEndIso: "2026-04-02T02:00:00.000Z",
        usageDayStartHour: 6,
        usageDayEndHour: 2,
        totalActiveSeconds: 8 * 3600,
        sessionsCount: 22,
        uniqueDomains: 8,
        uniqueUrls: 24,
        byBrowser: [],
        topDomains: [],
        timeline: [],
        productivity: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          strategy: "test",
          score: 32,
          verdict: "High distraction",
          goodSeconds: 2 * 3600,
          neutralSeconds: 2 * 3600,
          wasteSeconds: 4 * 3600,
          goodPercent: 25,
          neutralPercent: 25,
          wastePercent: 50,
          topGoodDomains: [{ domain: "github.com", activeSeconds: 5400 }],
          topWasteDomains: [{ domain: "youtube.com", activeSeconds: 9000 }],
          pendingManualDomains: [],
          aiEnabled: true,
          youtubeClassifiedVideos: 1,
          youtubePendingVideos: 0,
          manualDomainLabels: []
        },
        recentEvents: [
          {
            id: 1,
            browser: "zen",
            domain: "github.com",
            title: "Issue triage",
            url: "https://github.com",
            startedAt: "2026-04-01T07:00:00.000Z",
            endedAt: "2026-04-01T08:30:00.000Z",
            activeSeconds: 5400,
            sessions: 3,
            classificationLabel: "good",
            classificationReason: "manual",
            classificationSource: "manual"
          }
        ]
      }
    });

    expect(text).toContain("LockIn Daily Accountability Report (2026-04-01)");
    expect(text).toContain("Good:");
    expect(text).toContain("Waste:");
    expect(text).toContain("Reality check:");
    expect(text).toContain("AI Coach:");
  });

  it("formats accountability HTML with chart sections and current text summary", () => {
    const input: FormatAccountabilityMessageInput = {
      date: "2026-04-01",
      severeWasteDay: true,
      aiSummary: "Reduce context switching tomorrow.",
      snapshot: {
        date: "2026-04-01",
        generatedAt: "2026-04-02T07:30:00.000Z",
        usageDayStartIso: "2026-04-01T06:00:00.000Z",
        usageDayEndIso: "2026-04-02T02:00:00.000Z",
        usageDayStartHour: 6,
        usageDayEndHour: 2,
        totalActiveSeconds: 8 * 3600,
        sessionsCount: 22,
        uniqueDomains: 8,
        uniqueUrls: 24,
        byBrowser: [
          { browser: "zen", activeSeconds: 5 * 3600, sessions: 13 },
          { browser: "safari", activeSeconds: 3 * 3600, sessions: 9 }
        ],
        topDomains: [
          { domain: "github.com", activeSeconds: 5400, sessions: 4 },
          { domain: "youtube.com", activeSeconds: 9000, sessions: 7 }
        ],
        timeline: [
          { label: "06:00", activeSeconds: 120 },
          { label: "06:10", activeSeconds: 340 },
          { label: "06:20", activeSeconds: 80 },
          { label: "06:30", activeSeconds: 420 }
        ],
        productivity: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          strategy: "test",
          score: 32,
          verdict: "High distraction",
          goodSeconds: 2 * 3600,
          neutralSeconds: 2 * 3600,
          wasteSeconds: 4 * 3600,
          goodPercent: 25,
          neutralPercent: 25,
          wastePercent: 50,
          topGoodDomains: [{ domain: "github.com", activeSeconds: 5400 }],
          topWasteDomains: [{ domain: "youtube.com", activeSeconds: 9000 }],
          pendingManualDomains: [],
          aiEnabled: true,
          youtubeClassifiedVideos: 1,
          youtubePendingVideos: 0,
          manualDomainLabels: []
        },
        recentEvents: [
          {
            id: 1,
            browser: "zen",
            domain: "github.com",
            title: "Issue triage",
            url: "https://github.com",
            startedAt: "2026-04-01T07:00:00.000Z",
            endedAt: "2026-04-01T08:30:00.000Z",
            activeSeconds: 5400,
            sessions: 3,
            classificationLabel: "good",
            classificationReason: "manual",
            classificationSource: "manual"
          }
        ]
      }
    };

    const html = formatAccountabilityEmailHtml(input);
    expect(html).toContain("<html>");
    expect(html).toContain("Focus Quality Split");
    expect(html).toContain("Focus Timeline");
    expect(html).toContain("Recent Events");
    expect(html).toContain("Current Text Summary");
    expect(html).toContain("width:25%");
    expect(html).toContain("width:50%");
    expect(html).toContain("AI Coach");
  });
});
