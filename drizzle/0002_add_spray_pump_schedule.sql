-- Add spray pump start/end time columns to pest_control_schedules
ALTER TABLE "pest_control_schedules" ADD COLUMN IF NOT EXISTS "spray_pump_start_time" text;
ALTER TABLE "pest_control_schedules" ADD COLUMN IF NOT EXISTS "spray_pump_end_time" text;
