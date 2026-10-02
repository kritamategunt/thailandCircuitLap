import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ServiceError } from "./service";
import { uuidSchema } from "@/lib/validation";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

export const fail = (status: number, error: string) => json({ error }, status);

/** Wrap a route body: maps ServiceError/ZodError to clean JSON errors, hides internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ServiceError) return fail(e.status, e.message);
    if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues.slice(0, 5) }, 400);
    console.error(e);
    return fail(500, "Internal error");
  }
}

/** Validate a route [id] param as UUID (sanitizes IDs before they reach the DB). */
export function parseId(id: string): string {
  const r = uuidSchema.safeParse(id);
  if (!r.success) throw new ServiceError(400, "Invalid id");
  return r.data;
}

export type Ctx<P extends Record<string, string>> = { params: Promise<P> };
