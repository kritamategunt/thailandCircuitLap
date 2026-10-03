import { getGroupLive } from "@/lib/server/service";
import { clientIp, rateLimit } from "@/lib/server/security";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/groups/:id/live?since=<serverTime> — every rider in the group: new points + lap times (poll every few seconds). */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    if (!rateLimit(`glive:${id}:${clientIp(req)}`, 60, 60_000)) return fail(429, "Slow down");
    const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
    return json(await getGroupLive(id, since));
  });
}
