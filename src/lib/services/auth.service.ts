import { eq } from "drizzle-orm";

import {
  createId, findUserByEmail, hashPassword,
  normalizeEmail, sanitizeUser, verifyPassword,
} from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

function now() { return new Date(); }

export async function getUserRecord(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  if (!rows[0]) throw new Error("User not found.");
  return rows[0];
}

export async function signupUser(input: {
  name: string; email: string; password: string;
  farmName: string; location: string;
}) {
  const email = normalizeEmail(input.email);
  const existingUser = await findUserByEmail(email);
  if (existingUser !== null && existingUser !== undefined) {
    throw new Error("An account with that email already exists.");
  }
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters.");

  const timestamp = now();
  const userId = createId("user");
  await db.insert(users).values({
    id: userId,
    name: input.name.trim(),
    email,
    passwordHash: hashPassword(input.password),
    farmName: input.farmName.trim(),
    location: input.location.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return sanitizeUser(await getUserRecord(userId));
}

export async function loginUser(input: { email: string; password: string }) {
  const user = await findUserByEmail(input.email);
  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  return sanitizeUser(user);
}

export async function updateProfile(
  userId: string,
  input: { name: string; email: string; farmName: string; location: string }
) {
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(email);
  if (existing && existing.id !== userId) throw new Error("An account with that email already exists.");

  await db.update(users)
    .set({ name: input.name.trim(), email, farmName: input.farmName.trim(), location: input.location.trim(), updatedAt: now() })
    .where(eq(users.id, userId));

  return sanitizeUser(await getUserRecord(userId));
}
