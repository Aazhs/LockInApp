import { describe, expect, it } from "vitest";
import { getYoutubeVideoAiAttemptedIds, markYoutubeVideoAiAttempted, openDatabase } from "./db";

describe("youtube ai attempts", () => {
  it("updates attempted_at on every mark and respects retry cutoff", async () => {
    const db = openDatabase(":memory:");
    const videoId = "dQw4w9WgXcQ";

    markYoutubeVideoAiAttempted(db, videoId);
    const blockedImmediately = getYoutubeVideoAiAttemptedIds(db, [videoId], "1970-01-01T00:00:00.000Z");
    expect(blockedImmediately.has(videoId)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    markYoutubeVideoAiAttempted(db, videoId);

    const cutoffFuture = new Date(Date.now() + 1000).toISOString();
    const blockedWithFutureCutoff = getYoutubeVideoAiAttemptedIds(db, [videoId], cutoffFuture);
    expect(blockedWithFutureCutoff.has(videoId)).toBe(false);
  });
});
