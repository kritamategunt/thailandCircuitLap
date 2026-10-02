import { getTrackInfo } from "@/lib/server/service";
import { getTrack } from "@/tracks";
import { fail, handle, json, type Ctx } from "@/lib/server/http";

/** GET /api/tracks/:id — full track definition (geometry for the map + metadata). */
export async function GET(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params;
    const track = getTrack(id);
    if (!track) return fail(404, "Unknown track");
    return json({ info: getTrackInfo(id), definition: track });
  });
}
