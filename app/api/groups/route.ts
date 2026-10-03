import { createGroupSchema, readJson } from "@/lib/validation";
import { createGroup } from "@/lib/server/service";
import { clientIp, rateLimit } from "@/lib/server/security";
import { fail, handle, json } from "@/lib/server/http";

/** POST /api/groups { trackId, name? } -> { group }. Share /group/<id>; friends join from there. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!rateLimit(`group:${clientIp(req)}`, 10, 60_000)) return fail(429, "Too many groups");
    const body = await readJson(req);
    if (!body.ok) return fail(body.status, body.error);
    const input = createGroupSchema.parse(body.data);
    return json({ group: await createGroup(input.trackId, input.name) }, 201);
  });
}
