import type { GeoLine, GPSPoint, LapRecord, TrackDefinition } from "@/lib/types";
import { getTrack } from "@/tracks";
import {
  analyzeCorner,
  analyzeLap,
  buildSpeedSeries,
  compareLaps,
  processSession,
  sanitizePoints,
  sliceTrajectory,
  withStartFinish,
  type LapForCompare,
} from "@/lib/telemetry";
import * as repo from "./repo";
import { hashToken, newWriteToken, tokenMatches } from "./security";

/**
 * Application services shared by REST routes and the MCP server.
 * Throws ServiceError with an HTTP-ish status for expected failures.
 */
export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Recompute laps at most this often while a session is live (each upload). */
const LIVE_RECOMPUTE_INTERVAL_MS = 30_000;

function requireTrack(trackId: string): TrackDefinition {
  const t = getTrack(trackId);
  if (!t) throw new ServiceError(404, `Unknown track: ${trackId}`);
  return t;
}

/** Track as timed for this session (Free Road sessions apply their own start/finish). */
function sessionTrack(s: repo.SessionRow): TrackDefinition {
  return withStartFinish(requireTrack(s.track_id), s.start_finish);
}

async function requireSession(id: string): Promise<repo.SessionRow> {
  const s = await repo.getSessionRow(id);
  if (!s) throw new ServiceError(404, "Session not found");
  return s;
}

async function requireLap(id: string): Promise<repo.LapRow> {
  const l = await repo.getLapRow(id);
  if (!l) throw new ServiceError(404, "Lap not found");
  return l;
}

export function toLapRecord(r: repo.LapRow): LapRecord {
  return {
    id: r.id,
    sessionId: r.session_id,
    lapNumber: r.lap_number,
    kind: r.kind,
    isTimed: r.is_timed,
    startTime: r.start_ts,
    endTime: r.end_ts,
    metrics: r.metrics,
  };
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

export async function createSession(trackId: string, name?: string) {
  requireTrack(trackId);
  const writeToken = newWriteToken();
  const row = await repo.insertSession(trackId, name, hashToken(writeToken));
  return { session: repo.toTrackSession(row), writeToken };
}

export async function ingestPoints(sessionId: string, token: string | null, points: GPSPoint[]) {
  const s = await requireSession(sessionId);
  if (!tokenMatches(token, s.write_token_hash)) throw new ServiceError(401, "Invalid session token");
  await repo.upsertPoints(sessionId, points);
  // Late uploads after FINISH (offline queue draining) always re-time the session.
  const stale = !s.laps_computed_at || Date.now() - Date.parse(s.laps_computed_at) > LIVE_RECOMPUTE_INTERVAL_MS;
  if (s.status === "completed" || stale) await recomputeSession(sessionId);
  return { accepted: points.length };
}

export async function finishSession(sessionId: string, token: string | null) {
  const s = await requireSession(sessionId);
  if (!tokenMatches(token, s.write_token_hash)) throw new ServiceError(401, "Invalid session token");
  if (s.status !== "completed") await repo.updateSession(sessionId, { status: "completed", ended_at: new Date().toISOString() });
  return recomputeSession(sessionId);
}

/** Free Road: store the rider's start/finish line and re-time everything recorded so far. */
export async function setStartFinish(sessionId: string, token: string | null, line: GeoLine) {
  const s = await requireSession(sessionId);
  if (!tokenMatches(token, s.write_token_hash)) throw new ServiceError(401, "Invalid session token");
  if (!getTrack(s.track_id)?.free) throw new ServiceError(400, "Start/finish is fixed on circuits (calibrate tracks/*.ts instead)");
  await repo.updateSession(sessionId, { start_finish: line });
  return recomputeSession(sessionId);
}

/** Server is the source of truth for laps: deterministic recompute from all stored points. */
export async function recomputeSession(sessionId: string) {
  const s = await requireSession(sessionId);
  const track = sessionTrack(s);
  const raw = await repo.getPoints(sessionId);
  const processed = processSession(raw, track);
  await repo.replaceLaps(
    sessionId,
    processed.laps.map((l) => ({
      session_id: sessionId,
      lap_number: l.lapNumber,
      kind: l.kind,
      is_timed: l.isTimed,
      start_ts: Math.round(l.startTime),
      end_ts: Math.round(l.endTime),
      lap_time_ms: l.metrics.lapTimeMs,
      distance_m: l.metrics.distanceMeters,
      max_speed_kmh: l.metrics.maxSpeedKmh,
      avg_speed_kmh: l.metrics.averageSpeedKmh,
      gps_quality: l.metrics.gpsQuality,
      metrics: l.metrics,
      sectors: l.sectors.map((sp) => ({
        sector_id: sp.sectorId,
        start_ts: sp.startTime == null ? null : Math.round(sp.startTime),
        end_ts: sp.endTime == null ? null : Math.round(sp.endTime),
        time_ms: sp.timeMs == null ? null : Math.round(sp.timeMs),
      })),
    })),
  );
  await repo.updateSession(sessionId, { summary: processed.summary, laps_computed_at: new Date().toISOString() });
  return { lapCount: processed.laps.length, summary: processed.summary };
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export function getTrackInfo(trackId: string) {
  const t = requireTrack(trackId);
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    lengthMeters: t.lengthMeters ?? null,
    center: t.center,
    startFinish: t.startFinishLine,
    direction: t.direction,
    sectors: t.sectors.map((s) => ({ id: s.id, name: s.name, endLine: s.endLine ?? null })),
    corners: t.corners,
    hasRacingLine: !!t.racingLine,
    metadata: { verified: t.verified, notes: t.notes ?? null, lineToleranceMeters: t.lineToleranceMeters },
  };
}

export async function listSessions(limit = 20) {
  const rows = await repo.listSessionRows(limit);
  return rows.map((r) => ({ ...repo.toTrackSession(r), summary: r.summary }));
}

export async function getSessionDetail(sessionId: string) {
  const s = await requireSession(sessionId);
  const laps = (await repo.getLapRows(sessionId)).map(toLapRecord);
  return {
    session: repo.toTrackSession(s),
    summary: s.summary,
    lapsComputedAt: s.laps_computed_at,
    laps,
    track: { id: s.track_id, verified: getTrack(s.track_id) ? sessionTrack(s).verified : false },
    startFinish: s.start_finish ?? null,
  };
}

/** A fix older than this means the rider's phone is not sending (offline, paused, screen locked). */
const LIVE_STALE_MS = 120_000;
/** Max points per live poll; the first poll of a long session returns only the latest ones. */
const LIVE_MAX_POINTS = 3000;

/** Live view poll: session header + raw points newer than `sinceTs`. */
export async function getSessionLive(sessionId: string, sinceTs: number) {
  const s = await requireSession(sessionId);
  const raw = await repo.getPoints(sessionId, sinceTs + 1);
  return {
    session: { ...repo.toTrackSession(s), startFinish: s.start_finish ?? null },
    points: raw.slice(-LIVE_MAX_POINTS),
    serverTime: Date.now(),
  };
}

/** Riders currently sending GPS on a circuit (Free Road is never listed: those are public roads). */
export async function listLiveRiders(trackId: string) {
  const t = requireTrack(trackId);
  if (t.free) return [];
  const rows = await repo.listActiveSessionRows(trackId, new Date(Date.now() - 12 * 3600_000).toISOString());
  const withLast = await Promise.all(rows.map(async (r) => ({ r, last: await repo.getLatestPoint(r.id) })));
  return withLast
    .filter(({ last }) => last != null && Date.now() - last.ts < LIVE_STALE_MS)
    .map(({ r, last }) => ({ id: r.id, name: r.name, startedAt: r.started_at, lastFixAt: last!.ts, lat: last!.lat, lng: last!.lng, speed: last!.speed }));
}

export async function getSessionLaps(sessionId: string) {
  await requireSession(sessionId);
  return (await repo.getLapRows(sessionId)).map(toLapRecord);
}

/** Session trajectory for the map (downsampled to keep payloads small). */
export async function getSessionTrajectory(sessionId: string, maxPoints = 4000) {
  await requireSession(sessionId);
  const { points } = sanitizePoints(await repo.getPoints(sessionId));
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  return points.filter((_, i) => i % step === 0).map((p) => ({ t: p.timestamp, lat: p.latitude, lng: p.longitude, v: p.speed, a: p.accuracy, q: p.lowQuality ? 0 : 1 }));
}

/** Clean, lap-sliced points (with a small margin so interpolation at the boundaries works). */
async function lapPoints(lap: repo.LapRow) {
  const raw = await repo.getPoints(lap.session_id, lap.start_ts - 10_000, lap.end_ts + 10_000);
  return sliceTrajectory(sanitizePoints(raw).points, lap.start_ts, lap.end_ts);
}

async function loadForCompare(lap: repo.LapRow): Promise<LapForCompare & { isTimed: boolean }> {
  return { id: lap.id, lapNumber: lap.lap_number, metrics: lap.metrics, points: await lapPoints(lap), isTimed: lap.is_timed };
}

export async function getLapDetail(lapId: string, opts: { includePoints?: boolean } = {}) {
  const lap = await requireLap(lapId);
  const pts = await lapPoints(lap);
  const series = buildSpeedSeries(pts);
  const speeds = series.map((s) => s.speedKmh).filter((v): v is number => v != null).sort((a, b) => a - b);
  const pct = (p: number) => (speeds.length ? Math.round(speeds[Math.min(speeds.length - 1, Math.floor(p * speeds.length))]!) : null);
  return {
    lap: toLapRecord(lap),
    sectorTimes: lap.metrics.sectorTimes,
    gpsSummary: lap.metrics.gpsQuality,
    speedStatistics: {
      maxKmh: lap.metrics.maxSpeedKmh,
      averageKmh: lap.metrics.averageSpeedKmh,
      minKmh: pct(0),
      p50Kmh: pct(0.5),
      p90Kmh: pct(0.9),
      measuredSharePct: lap.metrics.gpsQuality.speedFromDevicePct,
    },
    points: opts.includePoints
      ? series.map((s) => ({ t: s.timestamp, lat: s.latitude, lng: s.longitude, d: Math.round(s.distance), v: s.speedKmh == null ? null : Math.round(s.speedKmh * 10) / 10, a: s.accuracy }))
      : undefined,
  };
}

export async function compareLapsById(lapAId: string, lapBId: string) {
  const [a, b] = await Promise.all([requireLap(lapAId), requireLap(lapBId)]);
  const s = await requireSession(a.session_id);
  const track = sessionTrack(s);
  const [la, lb] = await Promise.all([loadForCompare(a), loadForCompare(b)]);
  return compareLaps(la, lb, track.corners);
}

export async function getCornerData(lapId: string, cornerId: string) {
  const lap = await requireLap(lapId);
  const s = await requireSession(lap.session_id);
  const corner = requireTrack(s.track_id).corners.find((c) => c.id === cornerId);
  if (!corner) throw new ServiceError(404, `Corner ${cornerId} is not defined for this track (calibrate tracks/*.ts).`);
  return analyzeCorner(await lapPoints(lap), corner);
}

export async function analyzeLapById(lapId: string) {
  const lap = await requireLap(lapId);
  const s = await requireSession(lap.session_id);
  const track = sessionTrack(s);
  if (!s.summary) await recomputeSession(s.id);
  const summary = (await requireSession(s.id)).summary!;
  const bestRow = await repo.getBestLapRow(s.id);
  const [target, best] = await Promise.all([loadForCompare(lap), bestRow ? loadForCompare(bestRow) : Promise.resolve(null)]);
  const analysis = analyzeLap(target, best, summary, track.corners);
  return { ...analysis, track: { id: track.id, verified: track.verified } };
}
