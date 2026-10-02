import { getSessionLaps } from "@/lib/server/service";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/sessions/:id/laps */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => json({ laps: await getSessionLaps(parseId((await ctx.params).id)) }));
}
