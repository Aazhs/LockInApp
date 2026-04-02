import { describe, expect, it } from "vitest";
import { isTrackableUrl, normalizeDomain } from "./domain";

describe("normalizeDomain", () => {
  it("normalizes https domain and strips www", () => {
    expect(normalizeDomain("https://www.Example.com/page")).toBe("example.com");
  });

  it("returns null for unsupported protocol", () => {
    expect(normalizeDomain("about:blank")).toBeNull();
  });

  it("returns null for invalid url", () => {
    expect(normalizeDomain("not_a_url")).toBeNull();
  });

  it("returns null for localhost and loopback hosts", () => {
    expect(normalizeDomain("http://localhost:4317/dashboard")).toBeNull();
    expect(normalizeDomain("http://127.0.0.1:3000")).toBeNull();
    expect(normalizeDomain("http://127.20.1.8:8080")).toBeNull();
  });
});

describe("isTrackableUrl", () => {
  it("marks http url as trackable", () => {
    expect(isTrackableUrl("http://github.com")).toBe(true);
  });

  it("marks browser internal url as not trackable", () => {
    expect(isTrackableUrl("chrome://extensions")).toBe(false);
  });
});
