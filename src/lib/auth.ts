import crypto from "node:crypto";
import { addDays } from "date-fns";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/types";

const SESSION_COOKIE = "gansys_session";
const PASSWORD_ITERATIONS = 120_000;

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, originalHash] = storedHash.split(":");
  if (!salt || !originalHash) return false;
  const nextHash = crypto.pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), Buffer.from(nextHash, "hex"));
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export function createSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toSessionUser(value: typeof users.$inferSelect): SessionUser {
  return {
    id: value.id,
    name: value.name,
    email: value.email,
    farmName: value.farmName,
    location: value.location,
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : String(value.createdAt),
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : String(value.updatedAt),
  };
}

export async function createSession(userId: string) {
  const token = createSecret();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = addDays(now, 14);

  await db.insert(sessions).values({
    id: createId("session"),
    userId,
    tokenHash,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function setSessionCookie(token: string, expiresAt: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const tokenHash = hashToken(token);
  const now = new Date();

  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));

  const session = rows[0];
  if (!session) {
    await clearSessionCookie();
    return null;
  }

  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));

  const userRows = await db.select().from(users).where(eq(users.id, session.userId));
  const user = userRows[0];
  if (!user) {
    await clearSessionCookie();
    return null;
  }

  return toSessionUser(user);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required");
  return user;
}

export async function findUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
  // Neon HTTP driver may return a result object — extract the rows array explicitly
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return (rows[0] as typeof users.$inferSelect | undefined) ?? null;
}

export async function deleteSessionByToken(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
export function sanitizeUser(user: typeof users.$inferSelect): SessionUser {
  return toSessionUser(user);
}
