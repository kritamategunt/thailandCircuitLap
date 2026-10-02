import { getSessionTrajectory } from "@/lib/server/service";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/sessions/:id/trajectory — downsampled clean trajectory for the map. */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => json({ points: await getSessionTrajectory(parseId((await ctx.params).id)) }));
}
