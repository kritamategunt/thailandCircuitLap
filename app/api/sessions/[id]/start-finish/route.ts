import { readJson, startFinishSchema } from "@/lib/validation";
import { setStartFinish } from "@/lib/server/service";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** POST /api/sessions/:id/start-finish  body { line: GeoLine }  header x-session-token (Free Road only) */
export async function POST(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    if (!body.ok) return fail(body.status, body.error);
    const { line } = startFinishSchema.parse(body.data);
    return json(await setStartFinish(id, req.headers.get("x-session-token"), line));
  });
}
