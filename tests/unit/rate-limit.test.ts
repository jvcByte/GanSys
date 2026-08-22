import { describe, expect, it } from "vitest";

import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    expect(rateLimit("rate-limit:key1", 2, 60_000)).toBe(true);
    expect(rateLimit("rate-limit:key1", 2, 60_000)).toBe(true);
    expect(rateLimit("rate-limit:key1", 2, 60_000)).toBe(false);
  });

  it("resets after the window elapses", async () => {
    expect(rateLimit("rate-limit:key2", 1, 30)).toBe(true);
    expect(rateLimit("rate-limit:key2", 1, 30)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rateLimit("rate-limit:key2", 1, 30)).toBe(true);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("rate-limit:key3a", 1, 60_000)).toBe(true);
    expect(rateLimit("rate-limit:key3b", 1, 60_000)).toBe(true);
    expect(rateLimit("rate-limit:key3a", 1, 60_000)).toBe(false);
    expect(rateLimit("rate-limit:key3b", 1, 60_000)).toBe(false);
  });
});
