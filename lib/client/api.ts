"use client";
import type { GeoLine, GPSPoint, LapRecord, TrackDefinition, TrackSession } from "@/lib/types";
import type { LapComparison, LapAnalysis, SessionSummary } from "@/lib/telemetry";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export type SessionDetail = {
  session: TrackSession;
  summary: SessionSummary | null;
  lapsComputedAt: string | null;
  laps: LapRecord[];
  track: { id: string; verified: boolean };
  startFinish: GeoLine | null;
};

export type SessionLive = {
  session: TrackSession & { startFinish: GeoLine | null; groupId: string | null };
  points: GPSPoint[];
  serverTime: number;
};

export type Group = { id: string; trackId: string; name: string | null; createdAt: string };

export type GroupRider = {
  sessionId: string;
  name: string | null;
  status: TrackSession["status"];
  startedAt: string;
  startFinish: GeoLine | null;
  timedLaps: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  /** Newest fix — only on the first poll (`since=0`), so riders who stopped still show up. */
  latest: { timestamp: number; latitude: number; longitude: number; speed: number | null } | null;
  points: GPSPoint[];
};

export type GroupLive = { group: Group; riders: GroupRider[]; serverTime: number };

export type TrackGroup = Group & { riders: number; liveRiders: number };

export type LiveRider = {
  id: string;
  name: string | null;
  startedAt: string;
  lastFixAt: number;
  lat: number;
  lng: number;
  speed: number | null;
  groupId: string | null;
};

export type LapDetail = {
  lap: LapRecord;
  sectorTimes: Record<string, number | null>;
  gpsSummary: LapRecord["metrics"]["gpsQuality"];
  speedStatistics: { maxKmh: number; averageKmh: number; minKmh: number | null; p50Kmh: number | null; p90Kmh: number | null; measuredSharePct: number };
  points?: Array<{ t: number; lat: number; lng: number; d: number; v: number | null; a: number }>;
};

export type TrajectoryPoint = { t: number; lat: number; lng: number; v: number | null; a: number; q: 0 | 1 };

export const api = {
  createSession: (trackId: string, name?: string, groupId?: string) =>
    call<{ session: TrackSession; writeToken: string }>("/api/sessions", { method: "POST", body: JSON.stringify({ trackId, name, groupId }) }),
  createGroup: (trackId: string, name?: string) => call<{ group: Group }>("/api/groups", { method: "POST", body: JSON.stringify({ trackId, name }) }),
  groupLive: (id: string, since = 0) => call<GroupLive>(`/api/groups/${id}/live?since=${since}`),
  uploadPoints: (id: string, token: string, points: GPSPoint[]) =>
    call<{ accepted: number }>(`/api/sessions/${id}/gps`, { method: "POST", body: JSON.stringify({ points }), headers: { "x-session-token": token } }),
  finish: (id: string, token: string) => call(`/api/sessions/${id}/finish`, { method: "POST", headers: { "x-session-token": token } }),
  recompute: (id: string, token: string) => call(`/api/sessions/${id}/recompute`, { method: "POST", headers: { "x-session-token": token } }),
  setStartFinish: (id: string, token: string, line: GeoLine) =>
    call(`/api/sessions/${id}/start-finish`, { method: "POST", body: JSON.stringify({ line }), headers: { "x-session-token": token } }),
  live: (id: string, since = 0) => call<SessionLive>(`/api/sessions/${id}/live?since=${since}`),
  liveRiders: (trackId: string) => call<{ riders: LiveRider[] }>(`/api/tracks/${trackId}/live`),
  trackGroups: (trackId: string) => call<{ groups: TrackGroup[] }>(`/api/tracks/${trackId}/groups`),
  session: (id: string) => call<SessionDetail>(`/api/sessions/${id}`),
  trajectory: (id: string) => call<{ points: TrajectoryPoint[] }>(`/api/sessions/${id}/trajectory`),
  lap: (id: string, points = false) => call<LapDetail>(`/api/laps/${id}${points ? "?points=1" : ""}`),
  compare: (a: string, b: string) => call<LapComparison>(`/api/laps/${a}/compare?with=${b}`),
  analysis: (id: string) => call<LapAnalysis & { track: { verified: boolean } }>(`/api/laps/${id}/analysis`),
  track: (id: string) => call<{ definition: TrackDefinition }>(`/api/tracks/${id}`),
};
