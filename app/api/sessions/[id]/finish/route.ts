import { finishSession } from "@/lib/server/service";
import { handle, json, parseId, type Ctx } from "@/lib/server/http";

/** POST /api/sessions/:id/finish  header x-session-token -> recomputes laps (server is source of truth). */
export async function POST(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const id = parseId((await ctx.params).id);
    return json(await finishSession(id, req.headers.get("x-session-token")));
  });
}
