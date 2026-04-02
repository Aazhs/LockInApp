import { describe, expect, it } from "vitest";
import {
  enforceYoutubePolicy,
  extractYoutubeVideoId,
  isLikelyCsEducational,
  isLikelyDistraction,
  isForcedBadDomain,
  isYouTubeDomain
} from "./classification";

describe("classification policy helpers", () => {
  it("marks X/Twitter/Reddit as forced bad", () => {
    expect(isForcedBadDomain("x.com")).toBe(true);
    expect(isForcedBadDomain("twitter.com")).toBe(true);
    expect(isForcedBadDomain("reddit.com")).toBe(true);
    expect(isForcedBadDomain("news.ycombinator.com")).toBe(false);
  });

  it("detects youtube domains", () => {
    expect(isYouTubeDomain("youtube.com")).toBe(true);
    expect(isYouTubeDomain("m.youtube.com")).toBe(true);
    expect(isYouTubeDomain("youtu.be")).toBe(true);
    expect(isYouTubeDomain("vimeo.com")).toBe(false);
  });

  it("extracts youtube video ids from common URL formats", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
    expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("overrides non-CS good labels to waste/neutral", () => {
    const nonCs = {
      title: "Celebrity wedding rumours and gossip podcast",
      url: "https://www.youtube.com/watch?v=abc123xyz9"
    };
    const cs = {
      title: "FastAPI crash course in Hindi",
      url: "https://www.youtube.com/watch?v=def456uvw0"
    };

    expect(isLikelyDistraction(nonCs)).toBe(true);
    expect(isLikelyCsEducational(cs)).toBe(true);

    const nonCsAdjusted = enforceYoutubePolicy(nonCs, {
      label: "good",
      reason: "model said good",
      confidence: 0.9
    });
    expect(nonCsAdjusted.label).toBe("waste");

    const csAdjusted = enforceYoutubePolicy(cs, {
      label: "good",
      reason: "model said good",
      confidence: 0.9
    });
    expect(csAdjusted.label).toBe("good");
  });
});
