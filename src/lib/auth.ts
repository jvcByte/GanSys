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
  if (!salt || !originalHash) {
    return false;
  }
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
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function createSession(userId: string) {
  const token = createSecret();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = addDays(new Date(), 14).toISOString();
  db.insert(sessions)
    .values({
      id: createId("session"),
      userId,
      tokenHash,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    })
    .run();
  return { token, expiresAt };
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

export async function getCurrentUser() {
  const token = await getSessionToken();
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date().toISOString())))
    .get();

  if (!session) {
    await clearSessionCookie();
    return null;
  }

  db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, session.id)).run();
  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) {
    await clearSessionCookie();
    return null;
  }
  return toSessionUser(user);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

export function findUserByEmail(email: string) {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function deleteSessionByToken(token: string) {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function sanitizeUser(user: typeof users.$inferSelect): SessionUser {
  return toSessionUser(user);
}
