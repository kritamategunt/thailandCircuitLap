import { compareLapsById } from "@/lib/server/service";
import { fail, handle, json, parseId, type Ctx } from "@/lib/server/http";

/** GET /api/laps/:id/compare?with=<lapId> — deltas are (with) minus (:id). */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const other = new URL(req.url).searchParams.get("with");
    if (!other) return fail(400, "Missing ?with=<lapId>");
    return json(await compareLapsById(parseId((await ctx.params).id), parseId(other)));
  });
}
