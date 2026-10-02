"use client";
import { useEffect, useMemo, useState } from "react";
import type { Coordinate, GeoLine } from "@/lib/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { useSelectedTrack, useSessionTrack } from "@/lib/client/selectedTrack";
import { TrackPicker } from "@/components/TrackPicker";
import { api, type LiveRider, type TrajectoryPoint } from "@/lib/client/api";
import { TrackMap, type DraftMarker, type MapLine, type MapRider } from "@/components/TrackMap";
import Link from "next/link";
import { Panel, UncalibratedBanner } from "@/components/ui";

type Step = "sfA" | "sfB" | "s1A" | "s1B" | "s2A" | "s2B" | "corner";
const STEP_LABEL: Record<Step, string> = {
  sfA: "Start/Finish — point A (one track edge)",
  sfB: "Start/Finish — point B (other edge)",
  s1A: "End of Sector 1 — point A",
  s1B: "End of Sector 1 — point B",
  s2A: "End of Sector 2 — point A",
  s2B: "End of Sector 2 — point B",
  corner: "Corner apexes (tap each, in order T1, T2, …)",
};
const ORDER: Step[] = ["sfA", "sfB", "s1A", "s1B", "s2A", "s2B", "corner"];
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
    setPts({});
    setCorners([]);
    setStepIdx(0);
  }
  const [traj, setTraj] = useState<TrajectoryPoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pts, setPts] = useState<Partial<Record<Step, Coordinate>>>({});
  const [corners, setCorners] = useState<Coordinate[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const step = ORDER[stepIdx]!;

  useEffect(() => {
    if (!sessionId) return;
    api.trajectory(sessionId).then((r) => setTraj(r.points)).catch((e: Error) => setErr(e.message));
  }, [sessionId]);

  // Riders on this circuit right now (skipped while viewing one session or calibrating).
  const [liveRiders, setLiveRiders] = useState<LiveRider[]>([]);
  const watchLive = !sessionId && !calibrate && !track.free;
  useEffect(() => {
    setLiveRiders([]);
    if (!watchLive) return;
    let stop = false;
    const tick = () =>
      api
        .liveRiders(track.id)
        .then((r) => !stop && setLiveRiders(r.riders))
        .catch(() => {});
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

  const lines: MapLine[] = useMemo(
    () => (traj.length > 1 ? [{ id: "traj", coords: traj.map((p) => [p.lng, p.lat] as [number, number]), color: "#3ad7ff", speeds: traj.map((p) => (p.v == null ? null : p.v * 3.6)), width: 3 }] : []),
    [traj],
  );

  function onClick(c: Coordinate) {
    if (!calibrate) return;
    if (step === "corner") setCorners((cs) => [...cs, c]);
    else {
      setPts((p) => ({ ...p, [step]: c }));
      setStepIdx((i) => Math.min(i + 1, ORDER.length - 1));
    }
  }

  const line = (a?: Coordinate, b?: Coordinate): GeoLine | null => (a && b ? { pointA: a, pointB: b } : null);
  const sf = line(pts.sfA, pts.sfB);
  const s1 = line(pts.s1A, pts.s1B);
  const s2 = line(pts.s2A, pts.s2B);
  const draftLines = [sf, s1, s2].filter((l): l is GeoLine => !!l);
  const draftMarkers: DraftMarker[] = [
    ...ORDER.filter((k) => k !== "corner" && pts[k]).map((k) => ({ lng: pts[k]!.longitude, lat: pts[k]!.latitude, label: k.toUpperCase(), color: "#ff2d2d" })),
    ...corners.map((c, i) => ({ lng: c.longitude, lat: c.latitude, label: `T${i + 1}`, color: "#ffd500" })),
  ];

  const snippet = [
    sf && `  startFinishLine: {\n    pointA: ${coordTs(sf.pointA)},\n    pointB: ${coordTs(sf.pointB)},\n  },`,
    `  sectors: [\n    { id: "S1", name: "Sector 1"${s1 ? `, endLine: { pointA: ${coordTs(s1.pointA)}, pointB: ${coordTs(s1.pointB)} }` : ""} },\n    { id: "S2", name: "Sector 2"${s2 ? `, endLine: { pointA: ${coordTs(s2.pointA)}, pointB: ${coordTs(s2.pointB)} }` : ""} },\n    { id: "S3", name: "Sector 3" },\n  ],`,
    `  corners: [\n${corners.map((c, i) => `    { id: "T${i + 1}", name: "Turn ${i + 1}", apex: ${coordTs(c)} },`).join("\n")}\n  ],`,
    sf && "  verified: true,",
  ]
    .filter(Boolean)
    .join("\n");

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
        <Panel title="Calibration">
          <p className="mb-2 text-sm">
            Tap: <b className="text-flag">{STEP_LABEL[step]}</b>
          </p>
          <p className="mb-3 text-xs text-dim">
            Draw each line across the full track width (it is extended by {track.lineToleranceMeters} m each side). Use satellite view, ideally with a
            recorded session overlaid (&session=…).
          </p>
          <div className="flex flex-wrap gap-2">
            {ORDER.map((k, i) => (
              <button key={k} onClick={() => setStepIdx(i)} className={`rounded px-2 py-1 text-[11px] font-bold ${i === stepIdx ? "bg-flag text-black" : pts[k] ? "bg-go/20 text-go" : "bg-line"}`}>
                {k}
              </button>
            ))}
            <button onClick={() => setCorners((c) => c.slice(0, -1))} className="rounded bg-line px-2 py-1 text-[11px] font-bold">
              Undo corner
            </button>
            <button
              onClick={() => {
                setPts({});
                setCorners([]);
                setStepIdx(0);
              }}
              className="rounded bg-red/30 px-2 py-1 text-[11px] font-bold"
            >
              Reset
            </button>
          </div>
        </Panel>
      )}

      <TrackMap track={track} lines={lines} riders={riderDots} draftLines={draftLines} draftMarkers={draftMarkers} onMapClick={onClick} height={calibrate ? "55vh" : "70vh"} />

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
                  <Link href={`/live/${r.id}`} className="rounded bg-go/15 px-3 py-1.5 text-xs font-bold text-go uppercase">
                    Watch
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {calibrate && (
        <Panel
          title={`Paste into tracks/${track.id}.ts`}
          right={
            <button onClick={() => navigator.clipboard?.writeText(snippet)} className="rounded bg-flag px-3 py-1 text-xs font-bold text-black">
              Copy
            </button>
          }
        >
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-go">{snippet}</pre>
          <p className="mt-2 text-xs text-dim">
            Then redeploy and re-time old sessions with <code>POST /api/sessions/&lt;id&gt;/recompute</code> (or the “Re-time” button on the Laps page). If
            laps count in the wrong direction, set <code>direction</code> to &quot;left-to-right&quot; or &quot;right-to-left&quot;.
          </p>
        </Panel>
      )}
    </div>
  );
}
