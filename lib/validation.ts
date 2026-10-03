import { z } from "zod";

/** Max points per upload request (≈ 8 min at 1 Hz). Keeps payloads small. */
export const MAX_POINTS_PER_BATCH = 500;
/** Hard cap on request body (bytes) — checked before JSON parsing. */
export const MAX_BODY_BYTES = 256 * 1024;

const MIN_TS = Date.UTC(2020, 0, 1);

export const uuidSchema = z.uuid();

export const gpsPointSchema = z.object({
  timestamp: z
    .number()
    .int()
    .refine((t) => t >= MIN_TS && t <= Date.now() + 24 * 3600_000, "timestamp out of range"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(150).nullable(), // m/s (540 km/h ceiling)
  accuracy: z.number().min(0).max(100_000),
  altitude: z.number().min(-1000).max(10_000).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
});

export const gpsBatchSchema = z.object({
  points: z.array(gpsPointSchema).min(1).max(MAX_POINTS_PER_BATCH),
});

const coordinateSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

export const startFinishSchema = z.object({
  line: z.object({ pointA: coordinateSchema, pointB: coordinateSchema }),
});

export const createSessionSchema = z.object({
  trackId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().max(80).optional(),
  groupId: uuidSchema.optional(),
});

export const createGroupSchema = z.object({
  trackId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().trim().max(80).optional(),
});

/** Read + size-limit + parse JSON body. Returns null on failure (caller answers 4xx). */
export async function readJson(req: Request): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Payload too large" };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Payload too large" };
  try {
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
}
