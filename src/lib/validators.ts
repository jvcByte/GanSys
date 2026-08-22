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
  desiredNumericValue: z.number().finite().optional(),
  note: z.string().max(280).optional().default(""),
  overrideMinutes: z.number().int().min(1).max(180).optional().default(2),
}).refine(
  (value) => (value.desiredBooleanState === undefined) !== (value.desiredNumericValue === undefined),
  { message: "Provide exactly one of desiredBooleanState or desiredNumericValue.", path: ["desiredBooleanState"] }
);

export const scheduledCommandSchema = z.object({
  desiredBooleanState: z.boolean().optional(),
  desiredNumericValue: z.number().finite().optional(),
  note: z.string().max(280).optional().default(""),
  scheduledFor: z.string().datetime(), // ISO 8601 datetime string
}).refine(
  (value) => (value.desiredBooleanState === undefined) !== (value.desiredNumericValue === undefined),
  { message: "Provide exactly one of desiredBooleanState or desiredNumericValue.", path: ["desiredBooleanState"] }
);

export const alertQuerySchema = z.object({
  controllerId: z.string().min(2).max(64).optional(),
  status: z.enum(["open", "resolved"]).optional(),
});

export const historyQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d"]).default("24h"),
});

export const deviceSyncSchema = z.object({
  firmwareVersion: z.string().max(64).optional(),
  readings: z.array(
    z.object({
      channelKey: z.string().min(2).max(64),
      numericValue: z.number().finite().optional(),
      booleanState: z.boolean().optional(),
      rawValue: z.number().finite().optional(),
      rawUnit: z.string().max(32).optional(),
      status: z.string().max(32).optional(),
      payload: z.record(z.string().max(64), z.unknown()).optional().refine(
        (value) => value === undefined || Object.keys(value).length <= 20,
        { message: "payload must have at most 20 keys" }
      ),
    })
  ).max(200),
  acknowledgements: z
    .array(
      z.object({
        commandId: z.string().min(2).max(64),
        status: z.enum(["acknowledged", "executed", "failed"]),
        executedAt: z.string().datetime().optional(),
        deviceMessage: z.string().max(280).optional(),
      })
    )
    .max(100)
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
