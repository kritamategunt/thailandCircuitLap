import type { GeoLine, GPSPoint, LapKind, LapMetrics, TrackSession } from "@/lib/types";
import type { SessionSummary } from "@/lib/telemetry";
import { db } from "./supabase";

/** Data access only — no business logic. */

export type SessionRow = {
  id: string;
  track_id: string;
  name: string | null;
  status: "active" | "completed";
  started_at: string;
  ended_at: string | null;
  write_token_hash: string;
  summary: SessionSummary | null;
  laps_computed_at: string | null;
  /** Free Road only: start/finish dropped by the rider. Null on circuits. */
  start_finish: GeoLine | null;
  group_id: string | null;
};

export type GroupRow = { id: string; track_id: string; name: string | null; created_at: string };

export type LapRow = {
  id: string;
  session_id: string;
  lap_number: number;
  kind: LapKind;
  is_timed: boolean;
  start_ts: number;
  end_ts: number;
  lap_time_ms: number;
  distance_m: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  gps_quality: LapMetrics["gpsQuality"];
  metrics: LapMetrics;
};

type PointRow = {
  ts: number;
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number;
  altitude: number | null;
  heading: number | null;
};

const PAGE = 1000; // Supabase default max rows per request

export function toTrackSession(r: SessionRow): TrackSession {
  return { id: r.id, trackId: r.track_id, name: r.name, startedAt: r.started_at, endedAt: r.ended_at, status: r.status };
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function insertSession(trackId: string, name: string | undefined, tokenHash: string, groupId?: string): Promise<SessionRow> {
  const row = check(
    await db()
      .from("sessions")
      .insert({ track_id: trackId, name: name ?? null, write_token_hash: tokenHash, group_id: groupId ?? null })
      .select("*")
      .single<SessionRow>(),
  );
  if (!row) throw new Error("Session insert returned no row");
  return row;
}

export async function getSessionRow(id: string): Promise<SessionRow | null> {
  return check(await db().from("sessions").select("*").eq("id", id).maybeSingle<SessionRow>());
}

export async function listSessionRows(limit = 20): Promise<SessionRow[]> {
  return check(await db().from("sessions").select("*").order("started_at", { ascending: false }).limit(limit)) as SessionRow[];
}

export async function updateSession(id: string, patch: Partial<SessionRow>): Promise<void> {
  check(await db().from("sessions").update(patch).eq("id", id));
}

/** Idempotent: duplicates on (session_id, ts) are ignored, so retries from the offline queue are safe. */
export async function upsertPoints(sessionId: string, points: GPSPoint[]): Promise<void> {
  const rows = points.map((p) => ({
    session_id: sessionId,
    ts: p.timestamp,
    lat: p.latitude,
    lng: p.longitude,
    speed: p.speed,
    accuracy: p.accuracy,
    altitude: p.altitude ?? null,
    heading: p.heading ?? null,
  }));
  check(await db().from("gps_points").upsert(rows, { onConflict: "session_id,ts", ignoreDuplicates: true }));
}

/** All points of a session (optionally a time range), paged past the 1000-row limit. */
export async function getPoints(sessionId: string, fromTs?: number, toTs?: number): Promise<GPSPoint[]> {
  const out: GPSPoint[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = db().from("gps_points").select("ts,lat,lng,speed,accuracy,altitude,heading").eq("session_id", sessionId);
    if (fromTs != null) q = q.gte("ts", fromTs);
    if (toTs != null) q = q.lte("ts", toTs);
    const rows = check(await q.order("ts", { ascending: true }).range(offset, offset + PAGE - 1)) as PointRow[];
    for (const r of rows) {
      out.push({
        timestamp: Number(r.ts),
        latitude: r.lat,
        longitude: r.lng,
        speed: r.speed,
        accuracy: r.accuracy,
        altitude: r.altitude,
        heading: r.heading,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Newest stored fix, or null when the session has none. */
export async function getLatestPoint(sessionId: string): Promise<{ ts: number; lat: number; lng: number; speed: number | null } | null> {
  const rows = check(
    await db().from("gps_points").select("ts,lat,lng,speed").eq("session_id", sessionId).order("ts", { ascending: false }).limit(1),
  ) as Array<{ ts: number; lat: number; lng: number; speed: number | null }>;
  return rows[0] ? { ...rows[0], ts: Number(rows[0].ts) } : null;
}

/** Active sessions on a track started within `sinceIso` (newest first). */
export async function listActiveSessionRows(trackId: string, sinceIso: string, limit = 20): Promise<SessionRow[]> {
  return check(
    await db().from("sessions").select("*").eq("track_id", trackId).eq("status", "active").gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(limit),
  ) as SessionRow[];
}

export async function insertGroup(trackId: string, name: string | undefined): Promise<GroupRow> {
  const row = check(await db().from("groups").insert({ track_id: trackId, name: name ?? null }).select("*").single<GroupRow>());
  if (!row) throw new Error("Group insert returned no row");
  return row;
}

export async function getGroupRow(id: string): Promise<GroupRow | null> {
  return check(await db().from("groups").select("*").eq("id", id).maybeSingle<GroupRow>());
}

export async function listGroupSessionRows(groupId: string, limit = 30): Promise<SessionRow[]> {
  return check(await db().from("sessions").select("*").eq("group_id", groupId).order("started_at").limit(limit)) as SessionRow[];
}

/** Groups on a track created after `sinceIso` (newest first). */
export async function listRecentGroupRows(trackId: string, sinceIso: string, limit = 10): Promise<GroupRow[]> {
  return check(
    await db().from("groups").select("*").eq("track_id", trackId).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit),
  ) as GroupRow[];
}

export async function listSessionRowsByGroups(groupIds: string[]): Promise<SessionRow[]> {
  if (groupIds.length === 0) return [];
  return check(await db().from("sessions").select("*").in("group_id", groupIds)) as SessionRow[];
}

/** Points of several sessions that reached the server after `sinceIso` (server clock), oldest first. */
export async function getPointsReceivedSince(sessionIds: string[], sinceIso: string, limit: number): Promise<Array<GPSPoint & { sessionId: string }>> {
  if (sessionIds.length === 0) return [];
  const rows = check(
    await db()
      .from("gps_points")
      .select("session_id,ts,lat,lng,speed,accuracy,altitude,heading")
      .in("session_id", sessionIds)
      .gt("received_at", sinceIso)
      .order("received_at", { ascending: false })
      .limit(limit),
  ) as Array<PointRow & { session_id: string }>;
  return rows.reverse().map((r) => ({
    sessionId: r.session_id,
    timestamp: Number(r.ts),
    latitude: r.lat,
    longitude: r.lng,
    speed: r.speed,
    accuracy: r.accuracy,
    altitude: r.altitude,
    heading: r.heading,
  }));
}

/** Lap times of several sessions (no metrics payload) — enough for a leaderboard. */
export async function getLapTimes(sessionIds: string[]): Promise<Array<{ session_id: string; lap_number: number; is_timed: boolean; lap_time_ms: number }>> {
  if (sessionIds.length === 0) return [];
  return check(
    await db().from("laps").select("session_id,lap_number,is_timed,lap_time_ms").in("session_id", sessionIds).order("lap_number"),
  ) as Array<{ session_id: string; lap_number: number; is_timed: boolean; lap_time_ms: number }>;
}

export async function countPoints(sessionId: string): Promise<number> {
  const res = await db().from("gps_points").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

export async function getLapRows(sessionId: string): Promise<LapRow[]> {
  const rows = check(await db().from("laps").select("*").eq("session_id", sessionId).order("lap_number")) as LapRow[];
  return rows.map(normalizeLap);
}

export async function getLapRow(id: string): Promise<LapRow | null> {
  const r = check(await db().from("laps").select("*").eq("id", id).maybeSingle<LapRow>());
  return r ? normalizeLap(r) : null;
}

export async function getLapRowsByIds(ids: string[]): Promise<LapRow[]> {
  if (ids.length === 0) return [];
  return (check(await db().from("laps").select("*").in("id", ids)) as LapRow[]).map(normalizeLap);
}

export async function getBestLapRow(sessionId: string): Promise<LapRow | null> {
  const r = check(
    await db().from("laps").select("*").eq("session_id", sessionId).eq("is_timed", true).order("lap_time_ms").limit(1).maybeSingle<LapRow>(),
  );
  return r ? normalizeLap(r) : null;
}

export type LapUpsert = Omit<LapRow, "id"> & { sectors: Array<{ sector_id: string; start_ts: number | null; end_ts: number | null; time_ms: number | null }> };

/** Upsert laps keyed by (session_id, lap_number) — stable IDs across recomputes. */
export async function replaceLaps(sessionId: string, laps: LapUpsert[]): Promise<void> {
  const client = db();
  if (laps.length) {
    const saved = check(
      await client
        .from("laps")
        .upsert(
          laps.map(({ sectors: _s, ...l }) => ({ ...l, updated_at: new Date().toISOString() })),
          { onConflict: "session_id,lap_number" },
        )
        .select("id,lap_number"),
    ) as Array<{ id: string; lap_number: number }>;
    const idByNumber = new Map(saved.map((s) => [s.lap_number, s.id]));
    const sectorRows = laps.flatMap((l) => l.sectors.map((s) => ({ ...s, lap_id: idByNumber.get(l.lap_number)! })));
    if (sectorRows.length) check(await client.from("lap_sectors").upsert(sectorRows, { onConflict: "lap_id,sector_id" }));
  }
  check(await client.from("laps").delete().eq("session_id", sessionId).gt("lap_number", laps.length));
}

function normalizeLap(r: LapRow): LapRow {
  return { ...r, start_ts: Number(r.start_ts), end_ts: Number(r.end_ts) };
}
