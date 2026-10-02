"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoLine, GPSPoint, TrackDefinition } from "@/lib/types";
import { api, type SessionLive } from "@/lib/client/api";
import { LiveLapTimer, initialLiveState, type LiveState } from "@/lib/telemetry/liveTimer";
import { withStartFinish } from "@/lib/telemetry/freeRoad";
import { formatLapTime } from "@/lib/telemetry/analysis";
import { getTrack } from "@/tracks";
import { TrackMap, type MapLine, type MapRider } from "@/components/TrackMap";
import { Empty, Panel } from "@/components/ui";

const POLL_MS = 2_000;
const TRAIL_POINTS = 600;
/** Rider phone uploads every ~2 s; allow for network hiccups before calling it delayed/offline. */
const LIVE_MS = 15_000;
const OFFLINE_MS = 120_000;

type Status = "connecting" | "live" | "delayed" | "offline" | "finished";
const STATUS_STYLE: Record<Status, string> = {
  connecting: "bg-line text-dim",
  live: "bg-go text-black",
  delayed: "bg-flag text-black",
  offline: "bg-red text-ink",
  finished: "bg-line text-ink",
};

/**
 * Spectator view: polls the rider's uploaded GPS and replays it through the same
 * LiveLapTimer the rider's phone uses, so lap numbers/times match the live screen.
 */
export function LiveWatch({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionLive["session"] | null>(null);
  const [trail, setTrail] = useState<GPSPoint[]>([]);
  const [live, setLive] = useState<LiveState>(initialLiveState);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const all = useRef<GPSPoint[]>([]);
  const since = useRef(0);
  const timer = useRef<{ t: LiveLapTimer; line: GeoLine | null } | null>(null);

  useEffect(() => {
    let stop = false;
    let handle: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const r = await api.live(sessionId, since.current);
          if (stop) return;
          setErr(null);
          setSession(r.session);
          const base = getTrack(r.session.trackId);
          if (base) {
            const line = r.session.startFinish;
            // New start/finish (Free Road) -> rebuild the timer over everything seen so far.
            if (!timer.current || JSON.stringify(timer.current.line) !== JSON.stringify(line)) {
              timer.current = { t: new LiveLapTimer(withStartFinish(base, line)), line };
              for (const p of all.current) timer.current.t.feed(p);
            }
            for (const p of r.points) timer.current.t.feed(p);
            setLive(timer.current.t.getState());
          }
          if (r.points.length) {
            all.current = all.current.concat(r.points);
            since.current = r.points[r.points.length - 1]!.timestamp;
            setTrail(all.current.slice(-TRAIL_POINTS));
          }
        } catch (e) {
          if (!stop) setErr(e instanceof Error ? e.message : "Connection problem");
        }
      }
      if (!stop) handle = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(handle);
    };
  }, [sessionId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const base = session ? getTrack(session.trackId) : undefined;
  const track: TrackDefinition | undefined = base && withStartFinish(base, session?.startFinish);
  const last = trail[trail.length - 1];
  const ageMs = last ? now - last.timestamp : null;
  const status: Status =
    session?.status === "completed" ? "finished" : ageMs == null ? "connecting" : ageMs < LIVE_MS ? "live" : ageMs < OFFLINE_MS ? "delayed" : "offline";
  const isLive = status === "live" || status === "delayed";

  const lines: MapLine[] = useMemo(
    () =>
      trail.length > 1
        ? [{ id: "trail", coords: trail.map((p) => [p.longitude, p.latitude] as [number, number]), speeds: trail.map((p) => (p.speed == null ? null : p.speed * 3.6)), width: 4, color: "#fff" }]
        : [],
    [trail],
  );
  const riders: MapRider[] = useMemo(
    () => (last ? [{ id: sessionId, lng: last.longitude, lat: last.latitude, label: session?.name ?? "Rider", color: isLive ? "#19e27a" : "#888" }] : []),
    [last, sessionId, session?.name, isLive],
  );

  if (err && !session) return <p className="text-red">{err}</p>;
  if (!session || !track) return <Empty>Connecting…</Empty>;

  const currentLapMs = isLive && live.currentLapStart != null ? Math.max(0, now - live.currentLapStart) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.3em] text-flag uppercase">{track.name}</p>
          <h1 className="truncate text-2xl font-black">{session.name ?? "Rider"}</h1>
          <p className="text-xs text-dim">
            {ageMs == null ? "No GPS yet" : `Last fix ${Math.max(0, Math.round(ageMs / 1000))}s ago`}
            {last && ` · ±${Math.round(last.accuracy)}m`}
            {err && ` · ${err}`}
          </p>
        </div>
        <span className={`shrink-0 rounded px-3 py-1.5 text-xs font-black tracking-widest uppercase ${STATUS_STYLE[status]}`}>
          {status === "live" ? "● Live" : status}
        </span>
      </div>

      {track.free && !session.startFinish && <p className="text-xs text-flag">Free road — rider hasn&apos;t set a start/finish yet, so no lap times.</p>}

      <TrackMap track={track} lines={lines} riders={riders} follow draftLines={session.startFinish ? [session.startFinish] : []} height="55vh" />

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Speed" value={isLive && live.speedKmh != null ? `${Math.round(live.speedKmh)}` : "--"} unit="km/h" />
        <Stat label={`Lap ${live.lapNumber}`} value={formatLapTime(currentLapMs)} />
        <Stat label="Laps done" value={String(live.completedLaps.length)} />
        <Stat label="Last" value={formatLapTime(live.lastLapMs)} />
        <Stat label="Best" value={formatLapTime(live.bestLapMs)} best />
        <Stat label="Fixes" value={String(live.pointCount)} />
      </div>

      {live.completedLaps.length > 0 && (
        <Panel title="Laps">
          <ul className="divide-y divide-line text-sm">
            {[...live.completedLaps].reverse().map((l) => (
              <li key={l.lapNumber} className="flex justify-between py-1.5">
                <span className="text-dim">Lap {l.lapNumber}</span>
                <span className={`timing font-bold ${l.lapTimeMs === live.bestLapMs ? "text-best" : ""}`}>{formatLapTime(l.lapTimeMs)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-xs text-dim">
        Updates every {POLL_MS / 1000}s. Position lags the rider by a few seconds (phone uploads in batches).{" "}
        <Link href={`/laps?session=${sessionId}`} className="text-flag underline">
          Full lap analysis
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value, unit, best }: { label: string; value: string; unit?: string; best?: boolean }) {
  return (
    <div className="rounded-lg bg-panel p-2">
      <div className="text-[10px] font-bold tracking-widest text-dim uppercase">{label}</div>
      <div className={`timing text-xl font-black ${best ? "text-best" : ""}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] text-dim">{unit}</span>}
      </div>
    </div>
  );
}
