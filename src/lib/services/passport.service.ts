/**
 * Passport Service - Database operations for Food Safety Passports
 *
 * Handles profile management, certificate issuance, and verification.
 * Uses driver-aware transaction strategy:
 * - postgres-js (local/Railway): Uses db.transaction() for atomic operations
 * - Neon HTTP: Falls back to ordered writes + version guard for concurrency
 */

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { createId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import {
  channels,
  controllers,
  passportCertificates,
  passportProfileChannels,
  passportProfiles,
  telemetrySamples,
  users,
} from "@/lib/db/schema";
import {
  buildIssuanceDecision,
  evaluateRuleOutcome,
  generateCertificateId,
  getSuggestedBand,
  hashPayload,
  isCertifiableChannel,
  SIGNATURE_ALGO,
  signPayload,
  verifyPayload,
  type ChannelStats,
  type ProfileSnapshot,
  type RuleEvaluationResult,
  type RuleStatus,
  type VerificationState,
} from "@/lib/passport-policy";

function now() {
  return new Date();
}

// ===========================================
// Transaction Helper
// ===========================================

export type DbQuery = typeof db;

/**
 * Runs an operation inside a real interactive transaction when the active DB
 * driver supports it (postgres-js for local/Railway). The Neon HTTP driver
 * does not support interactive transactions, so there we fall back to ordered
 * writes combined with the optimistic profileVersion guard on issuance.
 */
async function withTransaction<T>(operation: (q: DbQuery) => Promise<T>): Promise<T> {
  const txDb = db as unknown as {
    transaction?: (callback: (q: DbQuery) => Promise<T>) => Promise<T>;
  };
  if (typeof txDb.transaction === "function") {
    return txDb.transaction(operation);
  }
  return operation(db);
}

// ===========================================
// Types
// ===========================================

async function getOwnedChannels(
  q: DbQuery,
  userId: string,
  channelIds: string[]
) {
  const controllerRows = await q
    .select({ id: controllers.id })
    .from(controllers)
    .where(eq(controllers.userId, userId));
  const controllerIds = controllerRows.map((c) => c.id);
  if (controllerIds.length === 0 || channelIds.length === 0) return [];
  return q
    .select()
    .from(channels)
    .where(and(inArray(channels.id, channelIds), inArray(channels.controllerId, controllerIds)));
}

/**
 * Validates rule channel ownership, eligibility, bounds and duplicates.
 * Throws on any invalid rule - nothing is persisted.
 */
async function validateRuleChannels(
  q: DbQuery,
  userId: string,
  rules: Array<{ channelId: string; minValue: number; maxValue: number }>
) {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.channelId)) {
      throw new Error(`Duplicate channel ${rule.channelId} in rules`);
    }
    seen.add(rule.channelId);
  }

  const channelRows = await getOwnedChannels(q, userId, rules.map((r) => r.channelId));
  const byId = new Map(channelRows.map((row) => [row.id, row]));

  for (const rule of rules) {
    const channel = byId.get(rule.channelId);
    if (!channel) {
      throw new Error(`Channel ${rule.channelId} not found or not owned by user`);
    }

    const eligibility = isCertifiableChannel({
      template: channel.template,
      kind: channel.kind,
      unit: channel.unit,
      latestNumericValue: channel.latestNumericValue,
    });
    if (!eligibility.eligible) {
      throw new Error(`Channel ${rule.channelId} is not eligible: ${eligibility.reason}`);
    }

    if (rule.minValue >= rule.maxValue) {
      throw new Error(`Rule for channel ${rule.channelId}: minValue must be less than maxValue`);
    }
  }
}

function assertRangeBounds(lookbackHours: number, maxDataAgeMinutes: number) {
  if (lookbackHours < 24 || lookbackHours > 720) {
    throw new Error("lookbackHours must be between 24 and 720");
  }
  if (maxDataAgeMinutes < 5 || maxDataAgeMinutes > 1440) {
    throw new Error("maxDataAgeMinutes must be between 5 and 1440");
  }
}
export type PassportProfileView = {
  id: string;
  name: string;
  productName: string;
  destination: string;
  lookbackHours: number;
  maxDataAgeMinutes: number;
  version: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  rules: Array<{
    id: string;
    channelId: string;
    channelName: string;
    channelTemplate: string;
    minValue: number;
    maxValue: number;
    unit: string;
    suggestedMin: number | null;
    suggestedMax: number | null;
  }>;
};

export type PassportOverview = {
  profiles: PassportProfileView[];
  certificates: Array<{
    id: string;
    profileId: string | null;
    profileName: string | null;
    productName: string;
    destination: string;
    status: string;
    issuedAt: string;
    revokedAt: string | null;
  }>;
};

export type CertificateView = {
  id: string;
  profileId: string | null;
  productName: string;
  destination: string;
  issuerName: string;
  farmName: string;
  farmLocation: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  payloadJson: string;
  payloadHash: string;
  signature: string;
  signatureAlgo: string;
  certificateVersion: number;
  signatureKeyId: string;
  issuedAt: string;
  revokedAt: string | null;
  verification: {
    state: VerificationState;
    hashValid: boolean;
    signatureValid: boolean;
  };
};

export type CreateProfileInput = {
  name: string;
  productName: string;
  destination: string;
  lookbackHours: number;
  maxDataAgeMinutes: number;
  rules: Array<{
    channelId: string;
    minValue: number;
    maxValue: number;
  }>;
};

export type UpdateProfileInput = Partial<Omit<CreateProfileInput, "rules">> & {
  rules?: Array<{
    channelId: string;
    minValue: number;
    maxValue: number;
  }>;
  enabled?: boolean;
};

export type IssuanceResult =
  | { success: true; certificate: CertificateView }
  | {
      success: false;
      code: "PASSPORT_NOT_COMPLIANT" | "PASSPORT_DISABLED" | "PROFILE_NOT_FOUND" | "VERSION_CONFLICT";
      reasons?: Array<{ channelId: string; status: RuleStatus; reason: string }>;
    };

// ===========================================
// Profile Management
// ===========================================

/**
 * Gets all passport profiles and recent certificates for a user.
 */
export async function getPassportOverview(userId: string): Promise<PassportOverview> {
  // Fetch profiles
  const profileRows = await db
    .select()
    .from(passportProfiles)
    .where(eq(passportProfiles.userId, userId))
    .orderBy(desc(passportProfiles.updatedAt));

  // Fetch rules for all profiles
  const profileIds = profileRows.map((p) => p.id);
  const ruleRows = profileIds.length
    ? await db
        .select({
          id: passportProfileChannels.id,
          profileId: passportProfileChannels.profileId,
          channelId: passportProfileChannels.channelId,
          minValue: passportProfileChannels.minValue,
          maxValue: passportProfileChannels.maxValue,
          channelName: channels.name,
          channelTemplate: channels.template,
          unit: channels.unit,
        })
        .from(passportProfileChannels)
        .innerJoin(channels, eq(passportProfileChannels.channelId, channels.id))
        .where(inArray(passportProfileChannels.profileId, profileIds))
    : [];

  // Group rules by profile
  const rulesByProfile = new Map<string, typeof ruleRows>();
  for (const rule of ruleRows) {
    const list = rulesByProfile.get(rule.profileId) ?? [];
    list.push(rule);
    rulesByProfile.set(rule.profileId, list);
  }

  // Fetch recent certificates
  const certRows = await db
    .select({
      id: passportCertificates.id,
      profileId: passportCertificates.profileId,
      productName: passportCertificates.productName,
      destination: passportCertificates.destination,
      status: passportCertificates.status,
      issuedAt: passportCertificates.issuedAt,
      revokedAt: passportCertificates.revokedAt,
    })
    .from(passportCertificates)
    .where(eq(passportCertificates.userId, userId))
    .orderBy(desc(passportCertificates.issuedAt))
    .limit(50);

  // Build profile views
  const profiles: PassportProfileView[] = profileRows.map((p) => {
    const rules = rulesByProfile.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.name,
      productName: p.productName,
      destination: p.destination,
      lookbackHours: p.lookbackHours,
      maxDataAgeMinutes: p.maxDataAgeMinutes,
      version: p.version,
      enabled: p.enabled,
      createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
      updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
      rules: rules.map((r) => {
        const suggested = getSuggestedBand(r.channelTemplate);
        return {
          id: r.id,
          channelId: r.channelId,
          channelName: r.channelName,
          channelTemplate: r.channelTemplate,
          minValue: r.minValue,
          maxValue: r.maxValue,
          unit: r.unit,
          suggestedMin: suggested?.min ?? null,
          suggestedMax: suggested?.max ?? null,
        };
      }),
    };
  });

  // Build certificate summaries
  const profileNameMap = new Map(profileRows.map((p) => [p.id, p.name]));
  const certificates = certRows.map((c) => ({
    id: c.id,
    profileId: c.profileId,
    profileName: c.profileId ? profileNameMap.get(c.profileId) ?? null : null,
    productName: c.productName,
    destination: c.destination,
    status: c.status,
    issuedAt: c.issuedAt instanceof Date ? c.issuedAt.toISOString() : String(c.issuedAt),
    revokedAt: c.revokedAt ? (c.revokedAt instanceof Date ? c.revokedAt.toISOString() : String(c.revokedAt)) : null,
  }));

  return { profiles, certificates };
}

/**
 * Gets a single profile with rule compliance status.
 */
export async function getPassportProfile(
  userId: string,
  profileId: string
): Promise<{ profile: PassportProfileView; compliance: Record<string, RuleEvaluationResult> } | null> {
  const profileRows = await db
    .select()
    .from(passportProfiles)
    .where(and(eq(passportProfiles.id, profileId), eq(passportProfiles.userId, userId)));

  if (!profileRows[0]) return null;

  const p = profileRows[0];

  // Fetch rules with channel info
  const ruleRows = await db
    .select({
      id: passportProfileChannels.id,
      channelId: passportProfileChannels.channelId,
      minValue: passportProfileChannels.minValue,
      maxValue: passportProfileChannels.maxValue,
      channelName: channels.name,
      channelTemplate: channels.template,
      unit: channels.unit,
    })
    .from(passportProfileChannels)
    .innerJoin(channels, eq(passportProfileChannels.channelId, channels.id))
    .where(eq(passportProfileChannels.profileId, p.id));

  // Evaluate compliance for each rule
  const compliance: Record<string, RuleEvaluationResult> = {};
  const windowStart = new Date(Date.now() - p.lookbackHours * 3600 * 1000);
  const staleBefore = new Date(Date.now() - p.maxDataAgeMinutes * 60 * 1000);

  for (const rule of ruleRows) {
    const stats = await getChannelStats(db, rule.channelId, windowStart, rule.minValue, rule.maxValue);
    const result = evaluateRuleOutcome(stats, rule.minValue, rule.maxValue, staleBefore);
    compliance[rule.channelId] = result;
  }

  // Build profile view
  const profile: PassportProfileView = {
    id: p.id,
    name: p.name,
    productName: p.productName,
    destination: p.destination,
    lookbackHours: p.lookbackHours,
    maxDataAgeMinutes: p.maxDataAgeMinutes,
    version: p.version,
    enabled: p.enabled,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
    rules: ruleRows.map((r) => {
      const suggested = getSuggestedBand(r.channelTemplate);
      return {
        id: r.id,
        channelId: r.channelId,
        channelName: r.channelName,
        channelTemplate: r.channelTemplate,
        minValue: r.minValue,
        maxValue: r.maxValue,
        unit: r.unit,
        suggestedMin: suggested?.min ?? null,
        suggestedMax: suggested?.max ?? null,
      };
    }),
  };

  return { profile, compliance };
}

/**
 * Creates a new passport profile.
 */
export async function createProfile(userId: string, input: CreateProfileInput): Promise<PassportProfileView> {
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error("At least one rule is required");
  }
  assertRangeBounds(input.lookbackHours, input.maxDataAgeMinutes);

  const profileId = createId("profile");

  await withTransaction(async (q) => {
    await validateRuleChannels(q, userId, input.rules);

    const timestamp = now();

    await q.insert(passportProfiles).values({
      id: profileId,
      userId,
      name: input.name.trim(),
      productName: input.productName.trim(),
      destination: input.destination.trim(),
      lookbackHours: input.lookbackHours,
      maxDataAgeMinutes: input.maxDataAgeMinutes,
      version: 1,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await q.insert(passportProfileChannels).values(
      input.rules.map((rule) => ({
        id: createId("ppc"),
        profileId,
        channelId: rule.channelId,
        minValue: rule.minValue,
        maxValue: rule.maxValue,
        createdAt: timestamp,
      }))
    );
  });

  const result = await getPassportProfile(userId, profileId);
  if (!result) throw new Error("Failed to fetch created profile");
  return result.profile;
}
export async function updateProfile(
  userId: string,
  profileId: string,
  input: UpdateProfileInput
): Promise<PassportProfileView> {
  await withTransaction(async (q) => {
    const profileRows = await q
      .select()
      .from(passportProfiles)
      .where(and(eq(passportProfiles.id, profileId), eq(passportProfiles.userId, userId)));
    if (!profileRows[0]) {
      throw new Error("Profile not found");
    }
    const existing = profileRows[0];

    const lookbackHours = input.lookbackHours ?? existing.lookbackHours;
    const maxDataAgeMinutes = input.maxDataAgeMinutes ?? existing.maxDataAgeMinutes;
    assertRangeBounds(lookbackHours, maxDataAgeMinutes);

    if (input.rules && input.rules.length > 0) {
      await validateRuleChannels(q, userId, input.rules);
    }

    // Policy-relevant changes bump the version; the enabled toggle does not.
    const policyRelevantChange =
      input.name !== undefined ||
      input.productName !== undefined ||
      input.destination !== undefined ||
      input.lookbackHours !== undefined ||
      input.maxDataAgeMinutes !== undefined ||
      input.rules !== undefined;

    const timestamp = now();

    await q
      .update(passportProfiles)
      .set({
        name: input.name?.trim() ?? existing.name,
        productName: input.productName?.trim() ?? existing.productName,
        destination: input.destination?.trim() ?? existing.destination,
        lookbackHours,
        maxDataAgeMinutes,
        enabled: input.enabled ?? existing.enabled,
        version: policyRelevantChange ? existing.version + 1 : existing.version,
        updatedAt: timestamp,
      })
      .where(eq(passportProfiles.id, profileId));

    // Replace rules transactionally - delete then insert inside the same transaction.
    if (input.rules && input.rules.length > 0) {
      await q.delete(passportProfileChannels).where(eq(passportProfileChannels.profileId, profileId));
      await q.insert(passportProfileChannels).values(
        input.rules.map((rule) => ({
          id: createId("ppc"),
          profileId,
          channelId: rule.channelId,
          minValue: rule.minValue,
          maxValue: rule.maxValue,
          createdAt: timestamp,
        }))
      );
    }
  });

  const result = await getPassportProfile(userId, profileId);
  if (!result) throw new Error("Profile not found");
  return result.profile;
}
export type CompliancePreviewResult = Array<{ channelId: string; result: RuleEvaluationResult }>;

/**
 * Evaluates an arbitrary (unsaved) set of rules against live telemetry.
 * Used by the profile form to preview compliance before a policy is saved.
 * Never trusts client results - channels are re-validated and statistics are
 * recomputed server-side.
 */
export async function previewCompliance(
  userId: string,
  input: {
    lookbackHours: number;
    maxDataAgeMinutes: number;
    rules: Array<{ channelId: string; minValue: number; maxValue: number }>;
  }
): Promise<CompliancePreviewResult> {
  assertRangeBounds(input.lookbackHours, input.maxDataAgeMinutes);
  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw new Error("At least one rule is required");
  }
  await validateRuleChannels(db, userId, input.rules);

  const windowStart = new Date(Date.now() - input.lookbackHours * 3600 * 1000);
  const staleBefore = new Date(Date.now() - input.maxDataAgeMinutes * 60 * 1000);

  const results: CompliancePreviewResult = [];
  for (const rule of input.rules) {
    const stats = await getChannelStats(db, rule.channelId, windowStart, rule.minValue, rule.maxValue);
    results.push({
      channelId: rule.channelId,
      result: evaluateRuleOutcome(stats, rule.minValue, rule.maxValue, staleBefore),
    });
  }
  return results;
}

export async function deleteProfile(userId: string, profileId: string): Promise<{ ok: boolean }> {
  const profileRows = await db
    .select()
    .from(passportProfiles)
    .where(and(eq(passportProfiles.id, profileId), eq(passportProfiles.userId, userId)));

  if (!profileRows[0]) {
    throw new Error("Profile not found");
  }

  // Delete profile (cascade deletes rules, SET NULL on certificates)
  await db.delete(passportProfiles).where(eq(passportProfiles.id, profileId));

  return { ok: true };
}

// ===========================================
// Certificate Issuance
// ===========================================

/**
 * Issues a passport certificate for a profile.
 * Evaluates compliance server-side - never trusts client results.
 * Uses version guard for concurrency safety on Neon HTTP.
 */
export async function issueCertificate(userId: string, profileId: string): Promise<IssuanceResult> {
  // Fetch user info for issuer details
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  const user = userRows[0];
  if (!user) {
    return { success: false, code: "PROFILE_NOT_FOUND" };
  }

  // Fetch profile
  const profileRows = await db
    .select()
    .from(passportProfiles)
    .where(and(eq(passportProfiles.id, profileId), eq(passportProfiles.userId, userId)));

  if (!profileRows[0]) {
    return { success: false, code: "PROFILE_NOT_FOUND" };
  }

  const profile = profileRows[0];
  const initialVersion = profile.version;

  // Check if profile is enabled
  if (!profile.enabled) {
    return { success: false, code: "PASSPORT_DISABLED" };
  }

  // Fetch rules with channel info
  const ruleRows = await db
    .select({
      channelId: passportProfileChannels.channelId,
      minValue: passportProfileChannels.minValue,
      maxValue: passportProfileChannels.maxValue,
      channelName: channels.name,
      channelTemplate: channels.template,
      unit: channels.unit,
    })
    .from(passportProfileChannels)
    .innerJoin(channels, eq(passportProfileChannels.channelId, channels.id))
    .where(eq(passportProfileChannels.profileId, profile.id));

  // Evaluate compliance for each rule
  const windowStart = new Date(Date.now() - profile.lookbackHours * 3600 * 1000);
  const staleBefore = new Date(Date.now() - profile.maxDataAgeMinutes * 60 * 1000);

  const evaluations: Array<{
    channelId: string;
    result: RuleEvaluationResult;
    channelName: string;
    unit: string;
  }> = [];

  for (const rule of ruleRows) {
    const stats = await getChannelStats(db, rule.channelId, windowStart, rule.minValue, rule.maxValue);
    const result = evaluateRuleOutcome(stats, rule.minValue, rule.maxValue, staleBefore);
    evaluations.push({
      channelId: rule.channelId,
      result,
      channelName: rule.channelName,
      unit: rule.unit,
    });
  }

  // Build profile snapshot for issuance decision
  const profileSnapshot: ProfileSnapshot = {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    productName: profile.productName,
    destination: profile.destination,
    lookbackHours: profile.lookbackHours,
    maxDataAgeMinutes: profile.maxDataAgeMinutes,
    version: profile.version,
    enabled: profile.enabled,
    rules: ruleRows.map((r) => ({
      channelId: r.channelId,
      channelName: r.channelName,
      channelTemplate: r.channelTemplate,
      minValue: r.minValue,
      maxValue: r.maxValue,
    })),
  };

  // Build issuance decision
  const decision = buildIssuanceDecision(
    profileSnapshot,
    evaluations,
    {
      issuerName: user.name,
      farmName: user.farmName,
      farmLocation: user.location,
    },
    now()
  );

  if (!decision.canIssue) {
    return {
      success: false,
      code: decision.reason === "disabled" ? "PASSPORT_DISABLED" : "PASSPORT_NOT_COMPLIANT",
      reasons: decision.details,
    };
  }

  // Sign the payload
  const signingSecret = process.env.PASSPORT_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("PASSPORT_SIGNING_SECRET not configured");
  }

  const payload = decision.payload;
  const payloadHash = hashPayload(payload);
  const signature = signPayload(payload, signingSecret);

  // Re-read profile version before insert (version guard for concurrency)
  const recheckRows = await db
    .select({ version: passportProfiles.version })
    .from(passportProfiles)
    .where(eq(passportProfiles.id, profileId));

  if (!recheckRows[0] || recheckRows[0].version !== initialVersion) {
    return { success: false, code: "VERSION_CONFLICT" };
  }

  // Insert certificate
  const certId = generateCertificateId();
  const timestamp = now();

  await db.insert(passportCertificates).values({
    id: certId,
    profileId: profile.id,
    userId: user.id,
    productName: payload.productName,
    destination: payload.destination,
    issuerName: payload.issuerName,
    farmName: payload.farmName,
    farmLocation: payload.farmLocation,
    windowStart: new Date(payload.windowStart),
    windowEnd: new Date(payload.windowEnd),
    status: "valid",
    payloadJson: JSON.stringify(payload),
    payloadHash,
    signature,
    signatureAlgo: SIGNATURE_ALGO,
    certificateVersion: payload.certificateVersion,
    signatureKeyId: payload.signatureKeyId,
    issuedAt: timestamp,
    revokedAt: null,
  });

  // Fetch and return the certificate
  const cert = await getCertificate(certId);
  if (!cert) {
    throw new Error("Failed to fetch created certificate");
  }

  return { success: true, certificate: cert };
}

/**
 * Revokes a certificate.
 */
export async function revokeCertificate(
  userId: string,
  certificateId: string
): Promise<{ ok: boolean }> {
  const certRows = await db
    .select()
    .from(passportCertificates)
    .where(and(eq(passportCertificates.id, certificateId), eq(passportCertificates.userId, userId)));

  if (!certRows[0]) {
    throw new Error("Certificate not found");
  }

  if (certRows[0].status === "revoked") {
    throw new Error("Certificate already revoked");
  }

  await db
    .update(passportCertificates)
    .set({ status: "revoked", revokedAt: now() })
    .where(eq(passportCertificates.id, certificateId));

  return { ok: true };
}

/**
 * Gets a certificate for verification (public, no auth required).
 */
export async function getCertificate(certificateId: string, ownerUserId?: string): Promise<CertificateView | null> {
  const conditions = [eq(passportCertificates.id, certificateId)];
  if (ownerUserId) {
    conditions.push(eq(passportCertificates.userId, ownerUserId));
  }
  const certRows = await db
    .select()
    .from(passportCertificates)
    .where(and(...conditions));

  if (!certRows[0]) return null;

  const cert = certRows[0];
  const signingSecret = process.env.PASSPORT_SIGNING_SECRET;

  // Parse payload for verification
  let payloadJson: string;
  try {
    payloadJson = cert.payloadJson;
  } catch {
    return null;
  }

  // Verify hash
  const expectedHash = hashPayload(JSON.parse(payloadJson));
  const hashValid = expectedHash === cert.payloadHash;

  // Verify signature
  let signatureValid = false;
  if (signingSecret) {
    try {
      signatureValid = verifyPayload(JSON.parse(payloadJson), signingSecret, cert.signature);
    } catch {
      signatureValid = false;
    }
  }

  // Compute verification state
  const state: VerificationState =
    cert.status === "revoked"
      ? "REVOKED"
      : !hashValid
        ? "TAMPERED"
        : !signingSecret
          ? "VERIFICATION_UNAVAILABLE"
          : !signatureValid
            ? "TAMPERED"
            : "VALID";

  return {
    id: cert.id,
    profileId: cert.profileId,
    productName: cert.productName,
    destination: cert.destination,
    issuerName: cert.issuerName,
    farmName: cert.farmName,
    farmLocation: cert.farmLocation,
    windowStart: cert.windowStart instanceof Date ? cert.windowStart.toISOString() : String(cert.windowStart),
    windowEnd: cert.windowEnd instanceof Date ? cert.windowEnd.toISOString() : String(cert.windowEnd),
    status: cert.status,
    payloadJson: cert.payloadJson,
    payloadHash: cert.payloadHash,
    signature: cert.signature,
    signatureAlgo: cert.signatureAlgo,
    certificateVersion: cert.certificateVersion,
    signatureKeyId: cert.signatureKeyId,
    issuedAt: cert.issuedAt instanceof Date ? cert.issuedAt.toISOString() : String(cert.issuedAt),
    revokedAt: cert.revokedAt ? (cert.revokedAt instanceof Date ? cert.revokedAt.toISOString() : String(cert.revokedAt)) : null,
    verification: {
      state,
      hashValid,
      signatureValid,
    },
  };
}

// ===========================================
// Helper Functions
// ===========================================

/**
 * Computes aggregate statistics for a channel within a time window.
 */
async function getChannelStats(
  q: DbQuery,
  channelId: string,
  windowStart: Date,
  minValue: number,
  maxValue: number
): Promise<ChannelStats> {
  const rows = await db
    .select({
      sampleCount: count(),
      outOfRangeCount: count(sql`CASE WHEN numeric_value < ${minValue} OR numeric_value > ${maxValue} THEN 1 END`),
      inRangeCount: count(sql`CASE WHEN numeric_value >= ${minValue} AND numeric_value <= ${maxValue} THEN 1 END`),
      min: sql<number>`MIN(numeric_value)`,
      max: sql<number>`MAX(numeric_value)`,
      avg: sql<number>`AVG(numeric_value)`,
      latest: sql<number>`(SELECT numeric_value FROM telemetry_samples WHERE channel_id = ${channelId} AND numeric_value IS NOT NULL ORDER BY recorded_at DESC LIMIT 1)`,
      latestObservedAt: sql<Date>`(SELECT recorded_at FROM telemetry_samples WHERE channel_id = ${channelId} AND numeric_value IS NOT NULL ORDER BY recorded_at DESC LIMIT 1)`,
    })
    .from(telemetrySamples)
    .where(
      and(
        eq(telemetrySamples.channelId, channelId),
        sql`${telemetrySamples.recordedAt} >= ${windowStart.toISOString()}::timestamptz`,
        sql`${telemetrySamples.numericValue} IS NOT NULL`
      )
    );

  const row = rows[0];

  return {
    sampleCount: Number(row?.sampleCount ?? 0),
    outOfRangeCount: Number(row?.outOfRangeCount ?? 0),
    inRangeCount: Number(row?.inRangeCount ?? 0),
    min: row?.min !== null ? Number(row?.min) : null,
    max: row?.max !== null ? Number(row?.max) : null,
    avg: row?.avg !== null ? Number(row?.avg) : null,
    latest: row?.latest !== null ? Number(row?.latest) : null,
    latestObservedAt: row?.latestObservedAt ?? null,
  };
}
