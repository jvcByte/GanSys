import { describe, expect, it } from "vitest";

import { computeControllerStatus } from "@/lib/services/controller.service";

describe("computeControllerStatus", () => {
  it("returns offline when there is no lastSeenAt", () => {
    expect(computeControllerStatus(null, 60)).toBe("offline");
  });

  it("returns online when lastSeenAt is within the heartbeat interval", () => {
    const lastSeen = new Date(Date.now() - 30_000).toISOString();
    expect(computeControllerStatus(lastSeen, 60)).toBe("online");
  });

  it("returns stale between the interval and twice the interval", () => {
    const lastSeen = new Date(Date.now() - 90_000).toISOString();
    expect(computeControllerStatus(lastSeen, 60)).toBe("stale");
  });

  it("returns offline after twice the heartbeat interval", () => {
    const lastSeen = new Date(Date.now() - 180_000).toISOString();
    expect(computeControllerStatus(lastSeen, 60)).toBe("offline");
  });
});
