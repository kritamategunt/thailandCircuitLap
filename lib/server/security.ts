import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newWriteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string | null | undefined, hash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Bearer check for MCP / admin endpoints. Fails closed when MCP_API_KEY is unset. */
export function apiKeyMatches(req: Request): boolean {
  const expected = process.env.MCP_API_KEY;
  if (!expected) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(hashToken(got), "hex");
  const b = Buffer.from(hashToken(expected), "hex");
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Best-effort in-memory rate limiter (per serverless instance). Good enough to stop a
// runaway client loop; swap for Upstash/Vercel KV if real abuse protection is needed.
// ---------------------------------------------------------------------------
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "unknown";
}
