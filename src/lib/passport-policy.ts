/**
 * Passport Policy and Cryptographic Functions
 *
 * Pure, DB-free functions for food safety passport compliance evaluation
 * and cryptographic integrity. All functions are unit-testable without
 * database dependencies.
 */

import { createHmac, createHash, randomBytes } from "crypto";
export { DEFAULT_COMPLIANCE_BANDS, getSuggestedBand } from "./passport-suggestions";

// ===========================================
// Constants
// ===========================================



/**
 * Channels that are never eligible for passport certificates.
 * Actuators, boolean/state channels, and non-numeric sensors are excluded.
 */
export const INELIGIBLE_TEMPLATES = new Set([
  "pump",
  "irrigation_valve",
  "flush_valve",
  "inlet_valve",
  "spray_pump",
  "uv_zapper",
  "camera_snapshot",
]);

/**
 * Templates that are known numeric sensor channels and therefore always
 * certifiable when they exist (regardless of current telemetry presence).
 * 'custom' is intentionally NOT here - it requires confirmed numeric evidence.
 */
export const NUMERIC_SENSOR_TEMPLATES = new Set([
  "tank_level",
  "soil_moisture",
  "turbidity",
  "fish_tank_level",
  "battery_voltage",
  "water_ph",
  "water_temperature",
]);

/**
 * Current certificate format version.
 * Increment when payload structure changes incompatibly.
 */
export const CERTIFICATE_VERSION = 1;

/**
 * Current signing key identifier.
 * v1 keeps a single secret; rotation invalidates old signatures
 * unless multi-key support is added (documented future extension).
 */
export const SIGNATURE_KEY_ID = "key_v1";

/**
 * Supported signature algorithm.
 */
export const SIGNATURE_ALGO = "HMAC-SHA256";

// ===========================================
// Types
// ===========================================

export type VerificationState = "VALID" | "REVOKED" | "TAMPERED" | "NOT_FOUND" | "VERIFICATION_UNAVAILABLE";

/**
 * Primary state of a single compliance rule evaluation.
 * Every rule produces exactly one of these states.
 */
export type RuleStatus = "pass" | "no_data" | "stale_data" | "out_of_range";

/**
 * Profile-level compliance status. A profile is "compliant" only when
 * every rule evaluates to "pass".
 */
export type ComplianceStatus = "compliant" | "non_compliant";

export type ChannelEligibility = 
  | { eligible: true; reason?: never }
  | { eligible: false; reason: string };

export type RuleEvaluationResult = {
  status: RuleStatus;
  sampleCount: number;
  outOfRangeCount: number;
  inRangeCount: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
  latestObservedAt: string | null;
  allowedMin: number;
  allowedMax: number;
  reason: string;
};

export type ChannelStats = {
  sampleCount: number;
  outOfRangeCount: number;
  inRangeCount: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
  latestObservedAt: Date | null;
};

export type ProfileSnapshot = {
  id: string;
  userId: string;
  name: string;
  productName: string;
  destination: string;
  lookbackHours: number;
  maxDataAgeMinutes: number;
  version: number;
  enabled: boolean;
  rules: Array<{
    channelId: string;
    channelName: string;
    channelTemplate: string;
    minValue: number;
    maxValue: number;
  }>;
};

export type IssuanceDecision = 
  | { 
      canIssue: true; 
      payload: PassportPayload;
      evaluations: Array<{ channelId: string; result: RuleEvaluationResult }>;
    }
  | { 
      canIssue: false; 
      reason: "disabled" | "non_compliant";
      details?: Array<{ channelId: string; status: RuleStatus; reason: string }>;
    };

export type PassportPayload = {
  certificateVersion: number;
  profileVersion: number;
  signatureKeyId: string;
  productName: string;
  destination: string;
  issuerName: string;
  farmName: string;
  farmLocation: string;
  windowStart: string;
  windowEnd: string;
  issuedAt: string;
  evidence: Array<{
    channelId: string;
    channelName: string;
    parameter: string;
    unit: string;
    allowedMin: number;
    allowedMax: number;
    observed: {
      min: number | null;
      max: number | null;
      avg: number | null;
      latest: number | null;
      sampleCount: number;
      latestObservedAt: string | null;
    };
    result: RuleStatus;
    reason: string;
  }>;
};

// ===========================================
// Channel Eligibility
// ===========================================

/**
 * Determines if a channel is eligible for inclusion in a passport profile.
 * Eligibility requires:
 * 1. Template is a known numeric sensor (not in INELIGIBLE_TEMPLATES)
 * 2. OR channel has confirmed numeric evidence (latestNumericValue !== null)
 * 
 * This validates the actual channel, not just the template name.
 */
export function isCertifiableChannel(params: {
  template: string;
  kind: string;
  unit: string;
  latestNumericValue: number | null;
}): ChannelEligibility {
  // Reject known ineligible templates (actuators, boolean, camera)
  if (INELIGIBLE_TEMPLATES.has(params.template)) {
    return { eligible: false, reason: `Template '${params.template}' is not a certifiable numeric sensor` };
  }

  // Reject boolean/state-only channels
  if (params.kind === "actuator" || params.unit === "state" || params.unit === "image") {
    return { eligible: false, reason: "Channel must be a numeric sensor, not an actuator or state/image channel" };
  }

  // Accept if template is a known numeric sensor template
  if (NUMERIC_SENSOR_TEMPLATES.has(params.template)) {
    return { eligible: true };
  }

  // For custom/unknown templates, require confirmed numeric telemetry evidence
  if (params.latestNumericValue !== null && Number.isFinite(params.latestNumericValue)) {
    return { eligible: true };
  }

  return { eligible: false, reason: "Channel has no confirmed numeric telemetry and is not a recognized numeric sensor" };
}

// ===========================================
// Rule Evaluation
// ===========================================

/**
 * Evaluates whether a channel's telemetry data meets compliance requirements.
 * Returns structured result with full statistics for dashboard and certificate evidence.
 */
export function evaluateRuleOutcome(
  stats: ChannelStats,
  minValue: number,
  maxValue: number,
  staleBefore: Date
): RuleEvaluationResult {
  const allowedMin = minValue;
  const allowedMax = maxValue;

  // No data case
  if (stats.sampleCount === 0 || stats.latest === null) {
    return {
      status: "no_data",
      sampleCount: 0,
      outOfRangeCount: 0,
      inRangeCount: 0,
      min: null,
      max: null,
      avg: null,
      latest: null,
      latestObservedAt: null,
      allowedMin,
      allowedMax,
      reason: "No telemetry data available for this channel",
    };
  }

  // Stale data case - latest observation is older than freshness requirement
  if (stats.latestObservedAt && stats.latestObservedAt < staleBefore) {
    const staleMinutes = Math.round((Date.now() - stats.latestObservedAt.getTime()) / 60000);
    return {
      status: "stale_data",
      sampleCount: stats.sampleCount,
      outOfRangeCount: stats.outOfRangeCount,
      inRangeCount: stats.inRangeCount,
      min: stats.min,
      max: stats.max,
      avg: stats.avg,
      latest: stats.latest,
      latestObservedAt: stats.latestObservedAt.toISOString(),
      allowedMin,
      allowedMax,
      reason: `Latest data is ${staleMinutes} minutes old (exceeds freshness requirement)`,
    };
  }

  // Check for out-of-range values
  if (stats.outOfRangeCount > 0) {
    return {
      status: "out_of_range",
      sampleCount: stats.sampleCount,
      outOfRangeCount: stats.outOfRangeCount,
      inRangeCount: stats.inRangeCount,
      min: stats.min,
      max: stats.max,
      avg: stats.avg,
      latest: stats.latest,
      latestObservedAt: stats.latestObservedAt?.toISOString() ?? null,
      allowedMin,
      allowedMax,
      reason: `${stats.outOfRangeCount} of ${stats.sampleCount} samples outside allowed range [${allowedMin}, ${allowedMax}]`,
    };
  }

  // All samples in range
  return {
    status: "pass",
    sampleCount: stats.sampleCount,
    outOfRangeCount: 0,
    inRangeCount: stats.inRangeCount,
    min: stats.min,
    max: stats.max,
    avg: stats.avg,
    latest: stats.latest,
    latestObservedAt: stats.latestObservedAt?.toISOString() ?? null,
    allowedMin,
    allowedMax,
    reason: `All ${stats.sampleCount} samples within allowed range [${allowedMin}, ${allowedMax}]`,
  };
}

// ===========================================
// Cryptographic Functions
// ===========================================

/**
 * Produces deterministic JSON string with sorted keys for consistent hashing.
 * Ensures identical payloads produce identical hashes regardless of key order.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  }
  
  const record = obj as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Computes SHA-256 hash of a payload for integrity verification.
 */
export function hashPayload(payload: unknown): string {
  const canonical = canonicalJson(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Signs a payload using HMAC-SHA256 with the provided secret.
 * Returns hex-encoded signature.
 */
export function signPayload(payload: unknown, secret: string, keyId: string = SIGNATURE_KEY_ID): string {
  const canonical = canonicalJson(payload);
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return signature;
}

/**
 * Verifies a payload's signature against the provided secret.
 * Returns true if signature matches, false otherwise.
 */
export function verifyPayload(payload: unknown, secret: string, signature: string): boolean {
  if (!secret) {
    // No secret configured - cannot verify
    return false;
  }
  const expectedSignature = signPayload(payload, secret);
  return signature === expectedSignature;
}

/**
 * Generates a secure random certificate ID.
 * Format: pass_{24-hex-chars} (12 random bytes = 24 hex chars)
 * Unpredictable and non-enumerable.
 */
export function generateCertificateId(): string {
  const bytes = randomBytes(12);
  return `pass_${bytes.toString("hex")}`;
}

// ===========================================
// Issuance Decision
// ===========================================

/**
 * Builds an issuance decision from profile snapshot and evaluations.
 * Pure function - produces the exact immutable payload object for the certificate.
 * 
 * Returns:
 * - { canIssue: true, payload, evaluations } if all rules pass
 * - { canIssue: false, reason, details } if any rule fails or profile disabled
 */
export function buildIssuanceDecision(
  profileSnapshot: ProfileSnapshot,
  evaluations: Array<{ channelId: string; result: RuleEvaluationResult; channelName: string; unit: string }>,
  issuerInfo: { issuerName: string; farmName: string; farmLocation: string },
  now: Date = new Date()
): IssuanceDecision {
  // Check if profile is enabled
  if (!profileSnapshot.enabled) {
    return { canIssue: false, reason: "disabled" };
  }

  // Check all evaluations
  const failedEvaluations: Array<{ channelId: string; status: RuleStatus; reason: string }> = [];
  
  for (const { channelId, result } of evaluations) {
    if (result.status !== "pass") {
      failedEvaluations.push({
        channelId,
        status: result.status,
        reason: result.reason,
      });
    }
  }

  // If any rule fails, return non-compliant
  if (failedEvaluations.length > 0) {
    return {
      canIssue: false,
      reason: "non_compliant",
      details: failedEvaluations,
    };
  }

  // All rules pass - build the immutable payload
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - profileSnapshot.lookbackHours * 3600 * 1000);

  const payload: PassportPayload = {
    certificateVersion: CERTIFICATE_VERSION,
    profileVersion: profileSnapshot.version,
    signatureKeyId: SIGNATURE_KEY_ID,
    productName: profileSnapshot.productName,
    destination: profileSnapshot.destination,
    issuerName: issuerInfo.issuerName,
    farmName: issuerInfo.farmName,
    farmLocation: issuerInfo.farmLocation,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    issuedAt: now.toISOString(),
    evidence: evaluations.map(({ channelId, channelName, unit, result }) => ({
      channelId,
      channelName,
      parameter: channelName,
      unit,
      allowedMin: result.allowedMin,
      allowedMax: result.allowedMax,
      observed: {
        min: result.min,
        max: result.max,
        avg: result.avg,
        latest: result.latest,
        sampleCount: result.sampleCount,
        latestObservedAt: result.latestObservedAt,
      },
      result: result.status,
      reason: result.reason,
    })),
  };

  return {
    canIssue: true,
    payload,
    evaluations: evaluations.map(({ channelId, result }) => ({ channelId, result })),
  };
}

// ===========================================
// Verification
// ===========================================

/**
 * Computes the verification state for a certificate.
 * State machine: VALID | REVOKED | TAMPERED | NOT_FOUND | VERIFICATION_UNAVAILABLE
 */
export function computeVerificationState(params: {
  found: boolean;
  revoked: boolean;
  hashValid: boolean;
  signatureValid: boolean;
  hasSecret: boolean;
}): VerificationState {
  if (!params.found) {
    return "NOT_FOUND";
  }

  if (params.revoked) {
    return "REVOKED";
  }

  if (!params.hashValid) {
    return "TAMPERED";
  }

  if (!params.hasSecret) {
    return "VERIFICATION_UNAVAILABLE";
  }

  if (!params.signatureValid) {
    return "TAMPERED";
  }

  return "VALID";
}

/**
 * Gets suggested compliance band for a template.
 * Returns null if no suggestion exists for the template.
 */
