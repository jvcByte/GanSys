import { describe, expect, it } from "vitest";

import { alertQuerySchema, commandSchema, deviceSyncSchema, scheduledCommandSchema } from "@/lib/validators";

describe("commandSchema", () => {
  it("accepts exactly one desired value", () => {
    expect(commandSchema.parse({ desiredBooleanState: true })).toMatchObject({ desiredBooleanState: true });
    expect(commandSchema.parse({ desiredNumericValue: 42 })).toMatchObject({ desiredNumericValue: 42 });
  });

  it("rejects commands with neither desired field", () => {
    expect(() => commandSchema.parse({})).toThrow();
  });

  it("rejects commands with both desired fields", () => {
    expect(() => commandSchema.parse({ desiredBooleanState: true, desiredNumericValue: 1 })).toThrow();
  });

  it("rejects non-finite numeric values", () => {
    expect(() => commandSchema.parse({ desiredNumericValue: Number.NaN })).toThrow();
    expect(() => commandSchema.parse({ desiredNumericValue: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("limits note length", () => {
    expect(() => commandSchema.parse({ desiredBooleanState: true, note: "x".repeat(281) })).toThrow();
    expect(commandSchema.parse({ desiredBooleanState: true, note: "x".repeat(280) })).toMatchObject({ note: "x".repeat(280) });
  });
});

describe("scheduledCommandSchema", () => {
  it("requires exactly one desired value and a valid ISO datetime", () => {
    expect(() => scheduledCommandSchema.parse({ desiredBooleanState: true })).toThrow(); // missing scheduledFor
    expect(() => scheduledCommandSchema.parse({ scheduledFor: "not-a-date" })).toThrow();
    expect(() => scheduledCommandSchema.parse({})).toThrow();
    expect(() => scheduledCommandSchema.parse({ desiredBooleanState: true, desiredNumericValue: 1, scheduledFor: "2030-01-01T00:00:00.000Z" })).toThrow();
    expect(
      scheduledCommandSchema.parse({ desiredBooleanState: false, scheduledFor: "2030-01-01T00:00:00.000Z" })
    ).toMatchObject({ desiredBooleanState: false });
  });
});

describe("deviceSyncSchema", () => {
  it("caps the readings array length", () => {
    const readings = Array.from({ length: 201 }, (_, i) => ({ channelKey: `ch${i}`, numericValue: 1 }));
    expect(() => deviceSyncSchema.parse({ readings })).toThrow();
  });

  it("caps acknowledgement count and restricts status values", () => {
    const acks = Array.from({ length: 101 }, () => ({ commandId: "cmd_x", status: "acknowledged" }));
    expect(() => deviceSyncSchema.parse({ readings: [], acknowledgements: acks })).toThrow();

    expect(() =>
      deviceSyncSchema.parse({ readings: [], acknowledgements: [{ commandId: "cmd_x", status: "bogus" }] })
    ).toThrow();

    expect(() =>
      deviceSyncSchema.parse({ readings: [], acknowledgements: [{ commandId: "cmd_x", status: "failed" }] })
    ).not.toThrow();
  });

  it("caps payload key count per reading", () => {
    const payload = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1]));
    expect(() => deviceSyncSchema.parse({ readings: [{ channelKey: "ch", payload }] })).toThrow();
  });

  it("rejects non-finite reading values", () => {
    expect(() => deviceSyncSchema.parse({ readings: [{ channelKey: "ch", numericValue: Number.NEGATIVE_INFINITY }] })).toThrow();
  });
});

describe("alertQuerySchema", () => {
  it("accepts only supported alert statuses", () => {
    expect(alertQuerySchema.parse({ status: "open" })).toMatchObject({ status: "open" });
    expect(alertQuerySchema.parse({ status: "resolved" })).toMatchObject({ status: "resolved" });
    expect(() => alertQuerySchema.parse({ status: "bogus" })).toThrow();
  });
});
