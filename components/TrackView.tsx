"use client";
import { useEffect, useMemo, useState } from "react";
import type { Coordinate } from "@/lib/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { useSelectedTrack, useSessionTrack } from "@/lib/client/selectedTrack";
import { TrackPicker } from "@/components/TrackPicker";
import { api, type LiveRider, type TrackGroup, type TrajectoryPoint } from "@/lib/client/api";
import { TrackMap, type DraftMarker, type MapLine, type MapRider } from "@/components/TrackMap";
import Link from "next/link";
import { Panel, UncalibratedBanner } from "@/components/ui";
import { SpeedTrace } from "@/components/SpeedTrace";
import { START_LINE_FORWARD, bearingDeg, headingAlong, startLineAt } from "@/lib/telemetry/freeRoad";

/** Half-width of a calibrated circuit start/finish (track is ~12–15 m wide; lineToleranceMeters extends it further). */
const SF_HALF_WIDTH_M = 10;
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;
const coordTs = (c: Coordinate) => `{ latitude: ${r7(c.latitude)}, longitude: ${r7(c.longitude)} }`;

export function TrackView({ sessionId, trackId, calibrate }: { sessionId: string | null; trackId: string | null; calibrate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, selectTrack] = useSelectedTrack();
  const sessionTrack = useSessionTrack(sessionId);
  // A session pins its own track; otherwise ?track= wins over the device's remembered pick.
  // Free Road has no layout to show here; fall back to the default circuit.
  const fallback = sessionId || selected.free ? getTrack(DEFAULT_TRACK_ID)! : selected;
  const track = (sessionId ? sessionTrack : getTrack(trackId ?? "")) ?? fallback;

  function pickTrack(id: string) {
    selectTrack(id);
    const q = new URLSearchParams(searchParams.toString());
    q.set("track", id);
    router.replace(`${pathname}?${q}`);
    resetCalibration();
  }
  const [traj, setTraj] = useState<TrajectoryPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Calibration: one tap on the start/finish; the line is drawn across the track automatically.
  const [sfPoint, setSfPoint] = useState<Coordinate | null>(null);
  /** Second tap, only when the riding direction can't be read from a recorded trail or the track layout. */
  const [dirPoint, setDirPoint] = useState<Coordinate | null>(null);
  function resetCalibration() {
    setSfPoint(null);
    setDirPoint(null);
  }

  useEffect(() => {
    if (!sessionId) return;
    api.trajectory(sessionId).then((r) => setTraj(r.points)).catch((e: Error) => setErr(e.message));
  }, [sessionId]);

  // Riders on this circuit right now (skipped while viewing one session or calibrating).
  const [liveRiders, setLiveRiders] = useState<LiveRider[]>([]);
  const [groups, setGroups] = useState<TrackGroup[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const watchLive = !sessionId && !calibrate && !track.free;
  useEffect(() => {
    setLiveRiders([]);
    setGroups([]);
    if (!watchLive) return;
    let stop = false;
    const tick = () => {
      api
        .liveRiders(track.id)
        .then((r) => !stop && setLiveRiders(r.riders))
        .catch(() => {});
      api
        .trackGroups(track.id)
        .then((r) => !stop && setGroups(r.groups))
        .catch(() => {});
    };
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), 5_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [track.id, watchLive]);
  const riderDots: MapRider[] = useMemo(
    () => liveRiders.map((r, i) => ({ id: r.id, lng: r.lng, lat: r.lat, label: r.name ?? `Rider ${i + 1}`, color: "#19e27a" })),
    [liveRiders],
  );

  async function createGroup() {
    setCreatingGroup(true);
    setErr(null);
    try {
      const { group } = await api.createGroup(track.id);
      router.push(`/group/${group.id}?join=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create group (are you online?)");
      setCreatingGroup(false);
    }
  }

  const lines: MapLine[] = useMemo(
    () => (traj.length > 1 ? [{ id: "traj", coords: traj.map((p) => [p.lng, p.lat] as [number, number]), color: "#3ad7ff", speeds: traj.map((p) => (p.v == null ? null : p.v * 3.6)), width: 3 }] : []),
    [traj],
  );

  // Riding direction at the tapped point: recorded trail (ordered by time) > track layout > second tap.
  const trailCoords = useMemo(() => traj.filter((p) => p.q === 1).map((p) => ({ latitude: p.lat, longitude: p.lng })), [traj]);
  const fromTrail = sfPoint ? headingAlong(trailCoords, sfPoint) : null;
  const fromLayout =
    sfPoint && fromTrail == null
      ? ((track.racingLine && headingAlong(track.racingLine, sfPoint)) ?? (track.boundary && headingAlong(track.boundary.left, sfPoint)) ?? null)
      : null;
  const needDirTap = sfPoint != null && fromTrail == null && fromLayout == null;
  const fromTaps = needDirTap && dirPoint ? bearingDeg(sfPoint, dirPoint) : null;
  const heading = fromTrail ?? fromLayout ?? fromTaps;
  const sf = sfPoint && heading != null ? startLineAt(sfPoint, heading, SF_HALF_WIDTH_M) : null;
  // Layout polylines aren't guaranteed to be stored in riding order, so only a trail or the user's tap fixes the direction.
  const direction = fromTrail != null || fromTaps != null ? START_LINE_FORWARD : "any";

  function onClick(c: Coordinate) {
    if (!calibrate) return;
    if (needDirTap && !dirPoint) setDirPoint(c);
    else {
      setSfPoint(c);
      setDirPoint(null);
    }
  }

  const draftLines = sf ? [sf] : [];
  const draftMarkers: DraftMarker[] = [
    ...(sfPoint ? [{ lng: sfPoint.longitude, lat: sfPoint.latitude, label: "S/F", color: "#ff2d2d" }] : []),
    ...(dirPoint && needDirTap ? [{ lng: dirPoint.longitude, lat: dirPoint.latitude, label: "→", color: "#ffd500" }] : []),
  ];

  const snippet = sf
    ? `  startFinishLine: {\n    pointA: ${coordTs(sf.pointA)},\n    pointB: ${coordTs(sf.pointB)},\n  },\n  direction: "${direction}",\n  verified: true,`
    : "";
  const calibrationHint = !sfPoint
    ? "Tap the start/finish line on the map (zoom in on satellite view)."
    : needDirTap && !dirPoint
      ? "Now tap a spot a little further along the track, in the direction you ride."
      : "Start/finish set. Tap the map again to move it.";

  // Speed over time for the overlaid session (same colours as the map).
  const speedSeries = useMemo(() => {
    const t0 = traj[0]?.t ?? 0;
    return traj.map((p) => ({ d: (p.t - t0) / 60_000, v: p.v == null ? null : p.v * 3.6 }));
  }, [traj]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black">{track.name}</h1>
          <p className="text-xs text-dim">
            {sessionId ? `Session ${sessionId.slice(0, 8)} trajectory (coloured by speed)` : "Track layout"} · pinch to zoom, two-finger drag to rotate/pitch
          </p>
        </div>
        {!calibrate && (
          <a href={`/track?calibrate=1&track=${track.id}${sessionId ? `&session=${sessionId}` : ""}`} className="rounded bg-line px-3 py-2 text-xs font-bold uppercase">
            Calibrate
          </a>
        )}
      </div>
      {!sessionId && <TrackPicker value={track.id} onChange={pickTrack} />}
      {!track.verified && !calibrate && <UncalibratedBanner trackId={track.id} />}
      {err && <p className="text-sm text-red">{err}</p>}

      {calibrate && (
        <Panel
          title="Calibrate start/finish"
          right={
            sfPoint && (
              <button onClick={resetCalibration} className="rounded bg-red/30 px-2 py-1 text-[11px] font-bold">
                Reset
              </button>
            )
          }
        >
          <p className={`text-sm font-semibold ${sf ? "text-go" : "text-flag"}`}>
            {sf ? "✓ " : ""}
            {calibrationHint}
          </p>
          {sf && direction === "any" && (
            <p className="mt-1 text-xs text-dim">Riding direction unknown, so laps count in both directions — fine for most tracks.</p>
          )}
          {!sessionId && (
            <p className="mt-2 text-xs text-dim">
              Tip: open a recorded session (Home → Map) and press Calibrate. Your trail shows exactly where the track is and sets the riding direction, so one tap
              is enough.
            </p>
          )}
        </Panel>
      )}

      <TrackMap track={track} lines={lines} riders={riderDots} draftLines={draftLines} draftMarkers={draftMarkers} onMapClick={onClick} height={calibrate ? "55vh" : "70vh"} />

      {sessionId && !calibrate && traj.length > 1 && (
        <Panel title="Speed">
          <SpeedTrace series={[{ label: "Session", color: "#fff", points: speedSeries }]} bySpeed xLabel="km/h vs time (min)" xUnit="min" />
        </Panel>
      )}

      {watchLive && (
        <Panel title={`Live on track (${liveRiders.length})`}>
          {liveRiders.length === 0 ? (
            <p className="text-sm text-dim">Nobody is sending GPS here right now. Riders appear when a session is recording on this circuit.</p>
          ) : (
            <ul className="divide-y divide-line">
              {liveRiders.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-go" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name ?? `Rider ${i + 1}`}</span>
                  <span className="timing text-sm text-dim">{r.speed == null ? "--" : Math.round(r.speed * 3.6)} km/h</span>
                  {r.groupId && (
                    <Link href={`/group/${r.groupId}`} className="rounded bg-line px-3 py-1.5 text-xs font-bold uppercase">
                      Group
                    </Link>
                  )}
                  <Link href={`/live/${r.id}`} className="rounded bg-go/15 px-3 py-1.5 text-xs font-bold text-go uppercase">
                    Watch
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {watchLive && (
        <Panel
          title={`Group rides (${groups.length})`}
          right={
            <button onClick={createGroup} disabled={creatingGroup} className="rounded bg-flag px-3 py-1 text-xs font-bold text-black uppercase disabled:opacity-50">
              {creatingGroup ? "Creating…" : "Create group"}
            </button>
          }
        >
          {groups.length === 0 ? (
            <p className="text-sm text-dim">No group rides here today. Create one and share the link — friends join and see each other live with a leaderboard.</p>
          ) : (
            <ul className="divide-y divide-line">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${g.liveRiders > 0 ? "bg-go" : "bg-line"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{g.name ?? "Group ride"}</span>
                    <span className="text-xs text-dim">
                      {g.riders} rider{g.riders === 1 ? "" : "s"} · {g.liveRiders} live
                    </span>
                  </span>
                  <Link href={`/group/${g.id}`} className="rounded bg-line px-3 py-1.5 text-xs font-bold uppercase">
                    Watch
                  </Link>
                  <Link href={`/group/${g.id}?join=1`} className="rounded bg-go/15 px-3 py-1.5 text-xs font-bold text-go uppercase">
                    Join
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {calibrate && sf && (
        <Panel
          title={`Replace these fields in tracks/${track.id}.ts`}
          right={
            <button onClick={() => navigator.clipboard?.writeText(snippet)} className="rounded bg-flag px-3 py-1 text-xs font-bold text-black">
              Copy
            </button>
          }
        >
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-go">{snippet}</pre>
          <p className="mt-2 text-xs text-dim">
            Then redeploy and re-time old sessions with <code>POST /api/sessions/&lt;id&gt;/recompute</code> (or the “Re-time” button on the Laps page). If
            laps count in the wrong direction, set <code>direction</code> to &quot;any&quot;.
          </p>
        </Panel>
      )}
    </div>
  );
}
