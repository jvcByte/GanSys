import { eq } from "drizzle-orm";

import { createId, findUserByEmail, hashPassword, normalizeEmail, sanitizeUser, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

function nowIso() {
  return new Date().toISOString();
}

export function getUserRecord(userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throw new Error("User not found.");
  }
  return user;
}

export function signupUser(input: { name: string; email: string; password: string; farmName: string; location: string }) {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(email)) {
    throw new Error("An account with that email already exists.");
  }
  if (input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const timestamp = nowIso();
  const userId = createId("user");
  db.insert(users)
    .values({
      id: userId,
      name: input.name.trim(),
      email,
      passwordHash: hashPassword(input.password),
      farmName: input.farmName.trim(),
      location: input.location.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return sanitizeUser(getUserRecord(userId));
}

export function loginUser(input: { email: string; password: string }) {
  const user = findUserByEmail(input.email);
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  return sanitizeUser(user);
}

export function updateProfile(userId: string, input: { name: string; email: string; farmName: string; location: string }) {
  const email = normalizeEmail(input.email);
  const existing = findUserByEmail(email);
  if (existing && existing.id !== userId) {
    throw new Error("An account with that email already exists.");
  }

  db.update(users)
    .set({
      name: input.name.trim(),
      email,
      farmName: input.farmName.trim(),
      location: input.location.trim(),
      updatedAt: nowIso(),
    })
    .where(eq(users.id, userId))
    .run();

  return sanitizeUser(getUserRecord(userId));
}
