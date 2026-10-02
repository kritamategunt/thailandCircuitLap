import { getSessionDetail } from "@/lib/server/service";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/sessions/:id — metadata, laps, summary. The UUID acts as a capability URL. */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => json(await getSessionDetail(parseId((await ctx.params).id))));
}
