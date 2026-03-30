import { formatDistanceToNowStrict, subDays, subHours } from "date-fns";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(" ");
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown) {
  return JSON.stringify(value ?? {});
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function formatRelativeTime(value: string | number | Date | null | undefined) {
  if (!value) {
    return "No activity yet";
  }
  return `${formatDistanceToNowStrict(new Date(value))} ago`;
}

export function getRangeStart(range: "24h" | "7d" | "30d") {
  switch (range) {
    case "24h":
      return subHours(new Date(), 24);
    case "7d":
      return subDays(new Date(), 7);
    case "30d":
    default:
      return subDays(new Date(), 30);
  }
}

export function getBucketSize(range: "24h" | "7d" | "30d") {
  switch (range) {
    case "24h":
      return 300;
    case "7d":
      return 3_600;
    case "30d":
    default:
      return 21_600;
  }
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
