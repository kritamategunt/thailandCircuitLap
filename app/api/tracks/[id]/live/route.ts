import { listLiveRiders } from "@/lib/server/service";
import { fail, handle, json, type Ctx } from "@/lib/server/http";

/** GET /api/tracks/:id/live — sessions on this circuit that sent GPS in the last 2 minutes, with their latest position. */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^[a-z0-9-]{1,64}$/.test(id)) return fail(400, "Invalid track id");
    return json({ riders: await listLiveRiders(id) });
  });
}
