import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export type RouteContext<TParams extends Record<string, string> = Record<string, string>> = {
  params: Promise<TParams>;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function jsonOk(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError("Authentication required.", 401);
  }
  return user;
}

export async function parseJson<T>(request: Request, schema: ZodType<T>) {
  try {
    return schema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError("Invalid JSON payload.", 400);
    }
    throw error;
  }
}

export async function getRouteParams<TParams extends Record<string, string>>(context: RouteContext<TParams>) {
  return context.params;
}

export function handleRoute<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response | unknown>
) {
  return async (...args: TArgs) => {
    try {
      const result = await handler(...args);
      return result instanceof Response ? result : jsonOk(result);
    } catch (error) {
      return jsonError(error);
    }
  };
}
