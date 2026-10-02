import { getLapDetail } from "@/lib/server/service";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/laps/:id[?points=1] — metrics, sectors, GPS summary, speed stats, optional trace. */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const includePoints = new URL(req.url).searchParams.get("points") === "1";
    return json(await getLapDetail(parseId((await ctx.params).id), { includePoints }));
  });
}
