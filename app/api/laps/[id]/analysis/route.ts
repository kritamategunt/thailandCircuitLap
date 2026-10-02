import { analyzeLapById, getCornerData } from "@/lib/server/service";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/laps/:id/analysis[?corner=T7] — structured AI-ready analysis (same data as MCP analyze_lap). */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    const corner = new URL(req.url).searchParams.get("corner");
    if (corner) {
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(corner)) return fail(400, "Invalid corner id");
      return json(await getCornerData(id, corner));
    }
    return json(await analyzeLapById(id));
  });
}
