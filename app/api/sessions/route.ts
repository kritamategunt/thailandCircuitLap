import { createSessionSchema, readJson } from "@/lib/validation";
import { createSession, listSessions } from "@/lib/server/service";
import { apiKeyMatches, clientIp, rateLimit } from "@/lib/server/security";
import { fail, handle, json } from "@/lib/server/http";

/** POST /api/sessions -> { session, writeToken }. Keep writeToken on the device. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!rateLimit(`create:${clientIp(req)}`, 20, 60_000)) return fail(429, "Too many sessions");
    const body = await readJson(req);
    if (!body.ok) return fail(body.status, body.error);
    const input = createSessionSchema.parse(body.data);
    return json(await createSession(input.trackId, input.name, input.groupId), 201);
  });
}

/** GET /api/sessions — listing ALL sessions is an admin/AI operation (Bearer MCP_API_KEY). */
export async function GET(req: Request) {
  return handle(async () => {
    if (!apiKeyMatches(req)) return fail(401, "Unauthorized");
    const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20));
    return json({ sessions: await listSessions(limit) });
  });
}
