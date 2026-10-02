import { getSessionLive } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/security";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/sessions/:id/live?since=<ts> — points newer than `since` for the live view (poll every few seconds). */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!rateLimit(`live:${id}:${req.headers.get("x-forwarded-for") ?? ""}`, 60, 60_000)) return fail(429, "Slow down");
    const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
    return json(await getSessionLive(id, since));
  });
}
