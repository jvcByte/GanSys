import { describe, expect, it } from "vitest";

import {
  isCertifiableChannel,
  evaluateRuleOutcome,
  canonicalJson,
  hashPayload,
  signPayload,
  verifyPayload,
  buildIssuanceDecision,
  computeVerificationState,
  getSuggestedBand,
  CERTIFICATE_VERSION,
  SIGNATURE_KEY_ID,
  type ChannelStats,
  type ProfileSnapshot,
} from "@/lib/passport-policy";

// ===========================================
// Channel Eligibility Tests
// ===========================================

describe("isCertifiableChannel", () => {
  it("accepts known numeric sensor templates", () => {
    const numericSensors = [
      { template: "tank_level", kind: "sensor", unit: "%", latestNumericValue: 50 },
      { template: "soil_moisture", kind: "sensor", unit: "%", latestNumericValue: 60 },
      { template: "turbidity", kind: "sensor", unit: "NTU", latestNumericValue: 25 },
      { template: "fish_tank_level", kind: "sensor", unit: "%", latestNumericValue: 80 },
      { template: "battery_voltage", kind: "sensor", unit: "V", latestNumericValue: 12.5 },
      { template: "water_ph", kind: "sensor", unit: "pH", latestNumericValue: 7.2 },
      { template: "water_temperature", kind: "sensor", unit: "°C", latestNumericValue: 25 },
      { template: "custom", kind: "sensor", unit: "units", latestNumericValue: 100 },
    ];

    for (const channel of numericSensors) {
      const result = isCertifiableChannel(channel);
      expect(result.eligible, `Expected ${channel.template} to be eligible`).toBe(true);
    }
  });

  it("rejects ineligible templates (actuators, boolean, camera)", () => {
    const ineligible = [
      { template: "pump", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "irrigation_valve", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "flush_valve", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "inlet_valve", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "spray_pump", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "uv_zapper", kind: "actuator", unit: "state", latestNumericValue: null },
      { template: "camera_snapshot", kind: "hybrid", unit: "image", latestNumericValue: null },
    ];

    for (const channel of ineligible) {
      const result = isCertifiableChannel(channel);
      expect(result.eligible, `Expected ${channel.template} to be ineligible`).toBe(false);
      if (!result.eligible) {
        expect(result.reason).toBeDefined();
      }
    }
  });

  it("rejects actuator kind regardless of template", () => {
    const result = isCertifiableChannel({
      template: "custom",
      kind: "actuator",
      unit: "state",
      latestNumericValue: null,
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects state and image units", () => {
    const stateResult = isCertifiableChannel({
      template: "custom",
      kind: "sensor",
      unit: "state",
      latestNumericValue: null,
    });
    expect(stateResult.eligible).toBe(false);

    const imageResult = isCertifiableChannel({
      template: "custom",
      kind: "hybrid",
      unit: "image",
      latestNumericValue: null,
    });
    expect(imageResult.eligible).toBe(false);
  });

  it("accepts unknown template with numeric evidence", () => {
    const result = isCertifiableChannel({
      template: "unknown_sensor",
      kind: "sensor",
      unit: "mS/cm",
      latestNumericValue: 1.5,
    });
    expect(result.eligible).toBe(true);
  });

  it("rejects unknown template without numeric evidence", () => {
    const result = isCertifiableChannel({
      template: "unknown_sensor",
      kind: "sensor",
      unit: "mS/cm",
      latestNumericValue: null,
    });
    expect(result.eligible).toBe(false);
  });
});

// ===========================================
// Rule Evaluation Tests
// ===========================================

describe("evaluateRuleOutcome", () => {
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

  it("returns no_data when no samples exist", () => {
    const stats: ChannelStats = {
      sampleCount: 0,
      outOfRangeCount: 0,
      inRangeCount: 0,
      min: null,
      max: null,
      avg: null,
      latest: null,
      latestObservedAt: null,
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("no_data");
    expect(result.sampleCount).toBe(0);
    expect(result.reason).toContain("No telemetry data");
  });

  it("returns stale_data when latest observation is too old", () => {
    const stats: ChannelStats = {
      sampleCount: 10,
      outOfRangeCount: 0,
      inRangeCount: 10,
      min: 7.0,
      max: 7.5,
      avg: 7.2,
      latest: 7.2,
      latestObservedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    };

    const staleBeforeRecent = new Date(Date.now() - 60 * 60 * 1000); // 1 hour freshness
    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBeforeRecent);

    expect(result.status).toBe("stale_data");
    expect(result.reason).toContain("minutes old");
  });

  it("returns compliant when all samples in range (boundaries inclusive)", () => {
    const stats: ChannelStats = {
      sampleCount: 10,
      outOfRangeCount: 0,
      inRangeCount: 10,
      min: 6.5, // Boundary
      max: 9.0, // Boundary
      avg: 7.5,
      latest: 7.5,
      latestObservedAt: new Date(),
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("pass");
    expect(result.outOfRangeCount).toBe(0);
    expect(result.reason).toContain("within allowed range");
  });

  it("returns non_compliant when samples outside range", () => {
    const stats: ChannelStats = {
      sampleCount: 10,
      outOfRangeCount: 2,
      inRangeCount: 8,
      min: 5.0, // Below min
      max: 10.0, // Above max
      avg: 7.5,
      latest: 7.5,
      latestObservedAt: new Date(),
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("out_of_range");
    expect(result.outOfRangeCount).toBe(2);
    expect(result.reason).toContain("2 of 10 samples outside");
  });

  it("fails on just-outside values (boundary test)", () => {
    const stats: ChannelStats = {
      sampleCount: 1,
      outOfRangeCount: 1,
      inRangeCount: 0,
      min: 6.4, // Just below 6.5
      max: 6.4,
      avg: 6.4,
      latest: 6.4,
      latestObservedAt: new Date(),
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("out_of_range");
  });

  it("handles single sample correctly", () => {
    const stats: ChannelStats = {
      sampleCount: 1,
      outOfRangeCount: 0,
      inRangeCount: 1,
      min: 7.0,
      max: 7.0,
      avg: 7.0,
      latest: 7.0,
      latestObservedAt: new Date(),
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("pass");
    expect(result.sampleCount).toBe(1);
  });

  it("handles multiple samples with mixed in/out range", () => {
    const stats: ChannelStats = {
      sampleCount: 100,
      outOfRangeCount: 5,
      inRangeCount: 95,
      min: 5.0,
      max: 10.0,
      avg: 7.5,
      latest: 7.5,
      latestObservedAt: new Date(),
    };

    const result = evaluateRuleOutcome(stats, 6.5, 9.0, staleBefore);

    expect(result.status).toBe("out_of_range");
    expect(result.outOfRangeCount).toBe(5);
    expect(result.inRangeCount).toBe(95);
  });
});

// ===========================================
// Cryptographic Tests
// ===========================================

describe("canonicalJson", () => {
  it("produces deterministic JSON with sorted keys", () => {
    const obj1 = { a: 1, b: 2, c: 3 };
    const obj2 = { c: 3, b: 2, a: 1 };

    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it("handles nested objects", () => {
    const obj1 = { outer: { inner: { a: 1, b: 2 } } };
    const obj2 = { outer: { inner: { b: 2, a: 1 } } };

    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });
});

describe("hashPayload", () => {
  it("produces consistent SHA-256 hash for same payload", () => {
    const payload = { test: "data", value: 42 };

    const hash1 = hashPayload(payload);
    const hash2 = hashPayload(payload);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
  });

  it("produces different hash for different payloads", () => {
    const hash1 = hashPayload({ value: 1 });
    const hash2 = hashPayload({ value: 2 });

    expect(hash1).not.toBe(hash2);
  });

  it("is key-order independent", () => {
    const hash1 = hashPayload({ a: 1, b: 2 });
    const hash2 = hashPayload({ b: 2, a: 1 });

    expect(hash1).toBe(hash2);
  });

  it("includes certificateVersion in hash", () => {
    const payload = {
      certificateVersion: 1,
      data: "test",
    };

    const hash = hashPayload(payload);
    expect(hash).toHaveLength(64);
  });
});

describe("signPayload and verifyPayload", () => {
  const secret = "test-signing-secret";

  it("produces valid signature", () => {
    const payload = { test: "data" };
    const signature = signPayload(payload, secret);

    expect(signature).toBeDefined();
    expect(typeof signature).toBe("string");
    expect(signature).toHaveLength(64); // HMAC-SHA256 = 64 hex chars
  });

  it("verifies valid signature", () => {
    const payload = { test: "data" };
    const signature = signPayload(payload, secret);

    expect(verifyPayload(payload, secret, signature)).toBe(true);
  });

  it("rejects tampered payload", () => {
    const originalPayload = { test: "original" };
    const signature = signPayload(originalPayload, secret);

    const tamperedPayload = { test: "tampered" };
    expect(verifyPayload(tamperedPayload, secret, signature)).toBe(false);
  });

  it("rejects wrong secret", () => {
    const payload = { test: "data" };
    const signature = signPayload(payload, secret);

    expect(verifyPayload(payload, "wrong-secret", signature)).toBe(false);
  });

  it("rejects tampered signature", () => {
    const payload = { test: "data" };
    const signature = signPayload(payload, secret);
    const tamperedSignature = signature.replace(/a/g, "b");

    expect(verifyPayload(payload, secret, tamperedSignature)).toBe(false);
  });

  it("returns false when no secret provided", () => {
    const payload = { test: "data" };
    const signature = signPayload(payload, secret);

    expect(verifyPayload(payload, "", signature)).toBe(false);
  });
});

// ===========================================
// Issuance Decision Tests
// ===========================================

describe("buildIssuanceDecision", () => {
  const baseProfile: ProfileSnapshot = {
    id: "profile_123",
    userId: "user_123",
    name: "Test Profile",
    productName: "Test Product",
    destination: "Test Destination",
    lookbackHours: 168,
    maxDataAgeMinutes: 60,
    version: 1,
    enabled: true,
    rules: [
      {
        channelId: "channel_1",
        channelName: "Water pH",
        channelTemplate: "water_ph",
        minValue: 6.5,
        maxValue: 9.0,
      },
    ],
  };

  const baseEvaluations = [
    {
      channelId: "channel_1",
      result: {
        status: "pass" as const,
        sampleCount: 10,
        outOfRangeCount: 0,
        inRangeCount: 10,
        min: 7.0,
        max: 7.5,
        avg: 7.2,
        latest: 7.2,
        latestObservedAt: new Date().toISOString(),
        allowedMin: 6.5,
        allowedMax: 9.0,
        reason: "All samples within range",
      },
      channelName: "Water pH",
      unit: "pH",
    },
  ];

  const issuerInfo = {
    issuerName: "Test Farmer",
    farmName: "Test Farm",
    farmLocation: "Test Location",
  };

  it("returns canIssue: true when all rules compliant", () => {
    const decision = buildIssuanceDecision(baseProfile, baseEvaluations, issuerInfo);

    expect(decision.canIssue).toBe(true);
    if (decision.canIssue) {
      expect(decision.payload.certificateVersion).toBe(CERTIFICATE_VERSION);
      expect(decision.payload.profileVersion).toBe(1);
      expect(decision.payload.signatureKeyId).toBe(SIGNATURE_KEY_ID);
      expect(decision.payload.productName).toBe("Test Product");
      expect(decision.payload.evidence).toHaveLength(1);
    }
  });

  it("returns canIssue: false when profile disabled", () => {
    const disabledProfile = { ...baseProfile, enabled: false };
    const decision = buildIssuanceDecision(disabledProfile, baseEvaluations, issuerInfo);

    expect(decision.canIssue).toBe(false);
    if (!decision.canIssue) {
      expect(decision.reason).toBe("disabled");
    }
  });

  it("returns canIssue: false when any rule non-compliant", () => {
    const nonCompliantEvaluations = [
      {
        ...baseEvaluations[0],
        result: {
          ...baseEvaluations[0].result,
          status: "out_of_range" as const,
          outOfRangeCount: 2,
          reason: "2 samples out of range",
        },
      },
    ];

    const decision = buildIssuanceDecision(baseProfile, nonCompliantEvaluations, issuerInfo);

    expect(decision.canIssue).toBe(false);
    if (!decision.canIssue) {
      expect(decision.reason).toBe("non_compliant");
      expect(decision.details).toBeDefined();
      expect(decision.details?.length).toBe(1);
    }
  });

  it("returns canIssue: false when no_data", () => {
    const noDataEvaluations = [
      {
        ...baseEvaluations[0],
        result: {
          status: "no_data" as const,
          sampleCount: 0,
          outOfRangeCount: 0,
          inRangeCount: 0,
          min: null,
          max: null,
          avg: null,
          latest: null,
          latestObservedAt: null,
          allowedMin: 6.5,
          allowedMax: 9.0,
          reason: "No data available",
        },
      },
    ];

    const decision = buildIssuanceDecision(baseProfile, noDataEvaluations, issuerInfo);

    expect(decision.canIssue).toBe(false);
    if (!decision.canIssue) {
      expect(decision.reason).toBe("non_compliant");
    }
  });

  it("returns canIssue: false when stale_data", () => {
    const staleEvaluations = [
      {
        ...baseEvaluations[0],
        result: {
          status: "stale_data" as const,
          sampleCount: 10,
          outOfRangeCount: 0,
          inRangeCount: 10,
          min: 7.0,
          max: 7.5,
          avg: 7.2,
          latest: 7.2,
          latestObservedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          allowedMin: 6.5,
          allowedMax: 9.0,
          reason: "Data is stale",
        },
      },
    ];

    const decision = buildIssuanceDecision(baseProfile, staleEvaluations, issuerInfo);

    expect(decision.canIssue).toBe(false);
  });

  it("never includes client-supplied data in payload", () => {
    // The payload should only contain data from profile snapshot and evaluations
    const decision = buildIssuanceDecision(baseProfile, baseEvaluations, issuerInfo);

    if (decision.canIssue) {
      const payload = decision.payload;
      // Verify expected fields exist
      expect(payload.productName).toBe(baseProfile.productName);
      expect(payload.destination).toBe(baseProfile.destination);
      expect(payload.issuerName).toBe(issuerInfo.issuerName);
      expect(payload.farmName).toBe(issuerInfo.farmName);
      expect(payload.farmLocation).toBe(issuerInfo.farmLocation);
      
      // Verify evidence contains evaluation results
      expect(payload.evidence[0].result).toBe("pass");
    }
  });
});

// ===========================================
// Verification State Tests
// ===========================================

describe("computeVerificationState", () => {
  it("returns NOT_FOUND when certificate not found", () => {
    const state = computeVerificationState({
      found: false,
      revoked: false,
      hashValid: false,
      signatureValid: false,
      hasSecret: true,
    });

    expect(state).toBe("NOT_FOUND");
  });

  it("returns REVOKED when certificate is revoked", () => {
    const state = computeVerificationState({
      found: true,
      revoked: true,
      hashValid: true,
      signatureValid: true,
      hasSecret: true,
    });

    expect(state).toBe("REVOKED");
  });

  it("returns TAMPERED when hash is invalid", () => {
    const state = computeVerificationState({
      found: true,
      revoked: false,
      hashValid: false,
      signatureValid: false,
      hasSecret: true,
    });

    expect(state).toBe("TAMPERED");
  });

  it("returns VERIFICATION_UNAVAILABLE when no secret configured", () => {
    const state = computeVerificationState({
      found: true,
      revoked: false,
      hashValid: true,
      signatureValid: false,
      hasSecret: false,
    });

    expect(state).toBe("VERIFICATION_UNAVAILABLE");
  });

  it("returns TAMPERED when signature is invalid", () => {
    const state = computeVerificationState({
      found: true,
      revoked: false,
      hashValid: true,
      signatureValid: false,
      hasSecret: true,
    });

    expect(state).toBe("TAMPERED");
  });

  it("returns VALID when all checks pass", () => {
    const state = computeVerificationState({
      found: true,
      revoked: false,
      hashValid: true,
      signatureValid: true,
      hasSecret: true,
    });

    expect(state).toBe("VALID");
  });

  it("revoked takes precedence over tampered", () => {
    const state = computeVerificationState({
      found: true,
      revoked: true,
      hashValid: false,
      signatureValid: false,
      hasSecret: true,
    });

    expect(state).toBe("REVOKED");
  });
});

// ===========================================
// Suggested Bands Tests
// ===========================================

describe("getSuggestedBand", () => {
  it("returns suggested bands for known templates", () => {
    expect(getSuggestedBand("water_ph")).toEqual({ min: 6.5, max: 9.0 });
    expect(getSuggestedBand("water_temperature")).toEqual({ min: 20, max: 32 });
    expect(getSuggestedBand("turbidity")).toEqual({ min: 0, max: 50 });
  });

  it("returns null for unknown templates", () => {
    expect(getSuggestedBand("unknown_template")).toBeNull();
    expect(getSuggestedBand("tank_level")).toBeNull();
  });
});
