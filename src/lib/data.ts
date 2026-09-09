/**
 * Barrel re-export — all domain logic now lives in src/lib/services/.
 * This file exists so existing imports from "@/lib/data" continue to work
 * without changes during the migration.
 */

export * from "./services/auth.service";
export * from "./services/alert.service";
export * from "./services/channel.service";
export * from "./services/command.service";
export * from "./services/controller.service";
export * from "./services/telemetry.service";
export * from "./services/snapshot.service";
export * from "./services/device-sync.service";
export * from "./services/pest.service";
export * from "./services/scheduled-command.service";

// Passport exports (renamed to avoid conflict with auth.service updateProfile)
export {
  getPassportOverview,
  getPassportProfile,
  createProfile,
  deleteProfile,
  issueCertificate,
  revokeCertificate,
  getCertificate,
  previewCompliance,
  type PassportProfileView,
  type PassportOverview,
  type CertificateView,
  type CreateProfileInput,
  type UpdateProfileInput,
  type IssuanceResult,
  type CompliancePreviewResult,
} from "./services/passport.service";

export { updateProfile as updatePassportProfile } from "./services/passport.service";
