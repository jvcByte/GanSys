import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  farmName: z.string().min(2),
  location: z.string().min(2),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const profileSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  farmName: z.string().min(2),
  location: z.string().min(2),
});

export const controllerSchema = z.object({
  name: z.string().min(2),
  hardwareId: z.string().min(4),
  location: z.string().min(2),
  description: z.string().optional().default(""),
  heartbeatIntervalSec: z.number().int().min(15).max(300).optional().default(60),
});

export const controllerPatchSchema = controllerSchema.partial();

export const channelSchema = z.object({
  channelKey: z.string().min(2),
  name: z.string().min(2),
  template: z.string().min(2),
  kind: z.enum(["sensor", "actuator", "hybrid"]).optional(),
  unit: z.string().min(1).optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  thresholdLow: z.number().nullable().optional(),
  thresholdHigh: z.number().nullable().optional(),
  warningLow: z.number().nullable().optional(),
  warningHigh: z.number().nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  calibration: z.record(z.string(), z.unknown()).optional(),
});

export const channelPatchSchema = channelSchema.partial();

export const commandSchema = z.object({
  desiredBooleanState: z.boolean().optional(),
  desiredNumericValue: z.number().optional(),
  note: z.string().optional().default(""),
  overrideMinutes: z.number().int().min(1).max(180).optional().default(2),
});

export const scheduledCommandSchema = z.object({
  desiredBooleanState: z.boolean().optional(),
  desiredNumericValue: z.number().optional(),
  note: z.string().optional().default(""),
  scheduledFor: z.string().datetime(), // ISO 8601 datetime string
});

export const alertQuerySchema = z.object({
  controllerId: z.string().optional(),
  status: z.string().optional(),
});

export const historyQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const deviceSyncSchema = z.object({
  firmwareVersion: z.string().optional(),
  readings: z.array(
    z.object({
      channelKey: z.string().min(2),
      numericValue: z.number().optional(),
      booleanState: z.boolean().optional(),
      rawValue: z.number().optional(),
      rawUnit: z.string().optional(),
      status: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  acknowledgements: z
    .array(
      z.object({
        commandId: z.string().min(2),
        status: z.string().min(2),
        executedAt: z.string().optional(),
        deviceMessage: z.string().optional(),
      })
    )
    .optional(),
});

// Validates "HH:MM" with hours 00–23 and minutes 00–59
const timeStringSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format")
  .refine((val) => {
    const [h, m] = val.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Invalid time value");

export const sprayEntrySchema = z.object({
  startTime: timeStringSchema,
  durationMinutes: z.number().int().min(1).max(120),
});

export const pestScheduleSchema = z.object({
  enabled: z.boolean(),
  sprayEntries: z.array(sprayEntrySchema).max(10),
  sprayPumpStartTime: timeStringSchema.nullable().optional(),
  sprayPumpEndTime: timeStringSchema.nullable().optional(),
  uvStartTime: timeStringSchema.nullable().optional(),
  uvEndTime: timeStringSchema.nullable().optional(),
});
