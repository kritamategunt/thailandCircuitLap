import { listTrackGroups } from "@/lib/server/service";
import { fail, handle, json, type Ctx } from "@/lib/server/http";

/** GET /api/tracks/:id/groups — group rides on this circuit from the last 12 hours, with rider counts. */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{1,64}$/.test(id)) return fail(400, "Invalid track id");
    return json({ groups: await listTrackGroups(id) });
  });
}
