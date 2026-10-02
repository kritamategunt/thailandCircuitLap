import { getSessionRow } from "@/lib/server/repo";
import { recomputeSession, ServiceError } from "@/lib/server/service";
import { apiKeyMatches, tokenMatches } from "@/lib/server/security";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/**
 * POST /api/sessions/:id/recompute — re-time a session (e.g. after calibrating the track).
 * Auth: session token (x-session-token) OR Bearer MCP_API_KEY.
 */
export async function POST(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    const s = await getSessionRow(id);
    if (!s) throw new ServiceError(404, "Session not found");
    if (!apiKeyMatches(req) && !tokenMatches(req.headers.get("x-session-token"), s.write_token_hash)) {
      throw new ServiceError(401, "Unauthorized");
    }
    return json(await recomputeSession(id));
  });
}
