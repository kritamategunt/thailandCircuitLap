import { gpsBatchSchema, readJson } from "@/lib/validation";
import { ingestPoints } from "@/lib/server/service";
import { rateLimit } from "@/lib/server/security";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** POST /api/sessions/:id/gps  body { points: GPSPoint[] }  header x-session-token */
export async function POST(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    // Client batches every ~2 s; 60/min leaves room for offline-queue catch-up bursts.
    if (!rateLimit(`gps:${id}`, 60, 60_000)) return fail(429, "Slow down");
    const body = await readJson(req);
    if (!body.ok) return fail(body.status, body.error);
    const { points } = gpsBatchSchema.parse(body.data);
    return json(await ingestPoints(id, req.headers.get("x-session-token"), points));
  });
}
