"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLiveSession } from "@/hooks/useLiveSession";
import { formatLapTime } from "@/lib/telemetry/analysis";
import { classifyAccuracy } from "@/lib/telemetry/quality";
import { TrackMap, type MapLine, type MapRider } from "@/components/TrackMap";
import { ShareLiveButton } from "@/components/ShareLiveButton";
import { riderStatus, useGroupFeed } from "@/hooks/useGroupFeed";
import { useAlertSettings, useRideAlerts, type AlertSettings } from "@/hooks/useRideAlerts";
import { gapTo, stoppedForMs, type RiderGap } from "@/lib/telemetry/groupGap";
import { formatDistance, formatGap, rideAlerts, type FriendState } from "@/lib/telemetry/rideSafety";

/** Friends' gaps are measured over this much of my own trail (~5 min at 1 Hz, matches the group feed window). */
const GAP_TRAIL_POINTS = 300;
const SPEED_LIMIT_MIN = 30;
const SPEED_LIMIT_MAX = 200;

const GPS_LABEL: Record<string, string> = {
  idle: "OFF",
  requesting: "ASKING",
  active: "ON",
  "signal-lost": "LOST",
  denied: "DENIED",
  unavailable: "NO FIX",
  unsupported: "N/A",
  error: "ERROR",
};

export function LiveSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const s = useLiveSession(sessionId);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [flash, setFlash] = useState(false);
  const [finishNote, setFinishNote] = useState<string | null>(null);
  const [view, setView] = useState<"timer" | "map">("timer");
  const [lineNote, setLineNote] = useState<string | null>(null);

  const trailLines: MapLine[] = useMemo(
    () =>
      s.trail.length > 1
        ? [{ id: "trail", coords: s.trail.map((p) => [p.longitude, p.latitude] as [number, number]), speeds: s.trail.map((p) => (p.speed == null ? null : p.speed * 3.6)), width: 4, color: "#fff" }]
        : [],
    [s.trail],
  );
  const lastFix = s.trail[s.trail.length - 1];

  // Riding with a group: friends on the map, gaps ahead/behind, safety alerts.
  const feed = useGroupFeed(s.meta?.groupId, 4_000);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const friends = useMemo(() => {
    const mine = s.trail.slice(-GAP_TRAIL_POINTS);
    return feed.riders
      .filter((r) => r.sessionId !== sessionId)
      .map((r) => ({ rider: r, gap: gapTo(mine, r.trail), stoppedMs: stoppedForMs(r.trail) }));
  }, [feed.riders, s.trail, sessionId]);

  const isFreeTrack = !!s.track?.free;
  // Public roads get a speed reminder by default; circuits don't.
  const alertDefaults: AlertSettings = useMemo(() => ({ sound: true, vibrate: true, speedLimitOn: isFreeTrack, speedLimitKmh: 100 }), [isFreeTrack]);
  const { settings: alertSettings, setSettings: setAlertSettings } = useAlertSettings(alertDefaults);
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const activeAlerts = useMemo(() => {
    if (s.recording !== "recording") return [];
    const states: FriendState[] = friends.map(({ rider, gap, stoppedMs }) => {
      const last = rider.trail[rider.trail.length - 1];
      return { id: rider.sessionId, name: rider.name ?? "Rider", gap, stoppedMs, signalAgeMs: last ? clock - last.timestamp : null, finished: rider.status === "completed" };
    });
    return rideAlerts({ mySpeedKmh: s.gps.status === "active" ? s.live.speedKmh : null, speedLimitKmh: alertSettings.speedLimitOn ? alertSettings.speedLimitKmh : null, friends: states });
  }, [s.recording, friends, clock, s.gps.status, s.live.speedKmh, alertSettings.speedLimitOn, alertSettings.speedLimitKmh]);
  const alerts = useRideAlerts(activeAlerts, { enabled: s.recording === "recording", settings: alertSettings });

  const riders: MapRider[] = useMemo(() => {
    const me: MapRider[] = lastFix ? [{ id: "me", lng: lastFix.longitude, lat: lastFix.latitude, color: "#19e27a" }] : [];
    const others = friends.flatMap(({ rider }) => {
      const p = rider.trail[rider.trail.length - 1];
      return p ? [{ id: rider.sessionId, lng: p.longitude, lat: p.latitude, label: rider.name ?? "Rider", color: rider.color }] : [];
    });
    return [...me, ...others]; // me first: the map follows the first rider
  }, [lastFix, friends]);
  const mapLines: MapLine[] = useMemo(
    () => [
      ...friends
        .filter(({ rider }) => rider.trail.length > 1)
        .map(({ rider }) => ({ id: `f-${rider.sessionId}`, coords: rider.trail.map((p) => [p.longitude, p.latitude] as [number, number]), color: rider.color, width: 2 })),
      ...trailLines,
    ],
    [friends, trailLines],
  );

  // Flash the screen on a start/finish crossing — readable at a glance.
  useEffect(() => {
    if (s.live.lastCrossingTime == null) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(t);
  }, [s.live.lastCrossingTime]);

  if (s.meta === undefined) return <div className="p-8 text-center text-dim">Loading…</div>;
  if (s.meta === null) {
    return (
      <div className="space-y-3 p-6 text-center">
        <p className="text-dim">This session was not started on this device, so it can&apos;t record here.</p>
        <Link className="font-bold text-flag underline" href={`/laps?session=${sessionId}`}>
          View laps
        </Link>
      </div>
    );
  }

  const track = s.track;
  const isFree = !!track?.free;
  const hasLine = !!s.meta.startFinish;
  const acc = classifyAccuracy(s.gps.status === "active" ? s.live.accuracy : null);
  const gpsOk = s.gps.status === "active";
  const gpsTone = !gpsOk ? "text-red" : acc === "good" ? "text-go" : acc === "fair" ? "text-flag" : "text-red";
  const lastIsBest = s.live.lastLapMs != null && s.live.lastLapMs === s.live.bestLapMs;

  async function onFinish() {
    setConfirmFinish(false);
    const confirmed = await s.finish();
    if (confirmed) router.push(`/laps?session=${sessionId}`);
    else setFinishNote("Saved on this phone. Laps will upload & finish automatically when you're back online.");
  }

  return (
    <div className={`fixed inset-0 flex flex-col bg-bg transition-colors ${flash ? "bg-best/30" : ""}`}>
      {/* status strip */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs font-bold tracking-widest uppercase">
        <Link href="/" className="text-dim">
          ◀ Exit
        </Link>
        <span className={gpsTone}>
          GPS {GPS_LABEL[s.gps.status]}
          {gpsOk && s.live.accuracy != null && ` ±${Math.round(s.live.accuracy)}m`}
        </span>
        <span className={s.queue.pending > 0 ? "text-flag" : "text-dim"}>
          {s.queue.pending > 0 ? `↑ ${s.queue.pending} queued` : "↑ synced"}
        </span>
      </div>

      {isFree && !hasLine && (
        <div className="bg-flag/15 px-4 py-1 text-center text-[11px] font-semibold text-flag">Free road — ride to your start point, then tap SET START/FINISH</div>
      )}
      {track && !isFree && !track.verified && (
        <div className="bg-flag/15 px-4 py-1 text-center text-[11px] font-semibold text-flag">Track not calibrated — recording only, no lap detection</div>
      )}
      {s.gps.status === "denied" && <div className="bg-red/20 px-4 py-2 text-center text-sm text-red">{s.gps.message}</div>}
      {s.hidden && s.recording === "recording" && (
        <div className="bg-red/20 px-4 py-1 text-center text-xs text-red">Keep this screen open — GPS may pause in background</div>
      )}

      <div className="flex items-center gap-2 px-4 pt-2">
        {(["timer", "map"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded px-3 py-1.5 text-xs font-black tracking-widest uppercase ${view === v ? "bg-flag text-black" : "bg-line"}`}
          >
            {v}
          </button>
        ))}
        <span className="ml-auto" />
        <button
          onClick={() => setShowAlertSettings(true)}
          aria-label="Safety alerts"
          className={`rounded px-2.5 py-1.5 text-xs font-black ${alertSettings.sound || alertSettings.vibrate ? "bg-line" : "bg-line text-dim line-through"}`}
        >
          🔔
        </button>
        {s.meta.groupId && (
          <Link href={`/group/${s.meta.groupId}`} className="rounded bg-line px-3 py-1.5 text-xs font-black tracking-widest uppercase">
            Group
          </Link>
        )}
        <ShareLiveButton sessionId={sessionId} />
      </div>

      {view === "map" && track && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-2">
          <div className="min-h-0 flex-1">
            <TrackMap
              track={track}
              lines={mapLines}
              riders={riders}
              follow
              draftLines={s.meta.startFinish ? [s.meta.startFinish] : []}
              height="100%"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-panel p-2">
              <div className="text-[10px] font-bold tracking-widest text-dim">SPEED</div>
              <div className="timing text-2xl font-black">{s.live.speedKmh == null || !gpsOk ? "--" : Math.round(s.live.speedKmh)}</div>
            </div>
            <div className="rounded bg-panel p-2">
              <div className="text-[10px] font-bold tracking-widest text-dim">LAP {s.live.lapNumber}</div>
              <div className="timing text-2xl font-black">{formatLapTime(s.currentLapMs)}</div>
            </div>
            <div className="rounded bg-panel p-2">
              <div className="text-[10px] font-bold tracking-widest text-dim">FIXES</div>
              <div className="timing text-2xl font-black">{s.live.pointCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* timing */}
      <div className={`grid flex-1 grid-rows-[auto_1fr_auto] gap-2 px-4 py-3 ${view === "map" ? "hidden" : ""}`}>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-dim">LAP</div>
            <div className="timing text-5xl font-black">{String(s.live.lapNumber).padStart(2, "0")}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold tracking-widest text-dim">SPEED</div>
            <div className="timing text-5xl font-black">
              {s.live.speedKmh == null || !gpsOk ? "--" : Math.round(s.live.speedKmh)}
              <span className="ml-1 text-base text-dim">km/h</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <div className="text-[11px] font-bold tracking-widest text-dim">
            CURRENT {s.live.currentLapTimed ? "" : "· OUT LAP"}
          </div>
          <div className="timing text-[17vw] leading-none font-black sm:text-8xl">{formatLapTime(s.currentLapMs)}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-panel p-3">
            <div className="text-[11px] font-bold tracking-widest text-dim">LAST</div>
            <div className={`timing text-3xl font-bold ${lastIsBest ? "text-best" : ""}`}>{formatLapTime(s.live.lastLapMs)}</div>
          </div>
          <div className="rounded-lg bg-panel p-3">
            <div className="text-[11px] font-bold tracking-widest text-dim">BEST</div>
            <div className="timing text-3xl font-bold text-best">{formatLapTime(s.live.bestLapMs)}</div>
          </div>
          {friends.length > 0 && <FriendStrip friends={friends} now={clock} />}
        </div>
      </div>

      {lineNote && <div className="px-4 pb-2 text-center text-sm text-flag">{lineNote}</div>}
      {isFree && (s.recording === "recording" || s.recording === "paused") && (
        <div className="px-4 pb-2">
          <button
            onClick={async () => {
              const err = await s.setStartFinishHere();
              setLineNote(err ?? "Start/finish set here. Laps count each time you pass this point.");
            }}
            className="w-full rounded-xl border-2 border-flag py-3 text-sm font-black tracking-widest text-flag uppercase"
          >
            {hasLine ? "Move start/finish here" : "Set start/finish here"}
          </button>
        </div>
      )}
      {finishNote && <div className="px-4 pb-2 text-center text-sm text-flag">{finishNote}</div>}

      {/* controls — big, thumb-sized */}
      <div className="grid grid-cols-2 gap-3 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {s.recording === "idle" && (
          <button
            onClick={() => {
              alerts.unlock();
              void s.start();
            }}
            className="col-span-2 rounded-xl bg-go py-6 text-2xl font-black tracking-widest text-black"
          >
            START
          </button>
        )}
        {s.recording === "recording" && (
          <>
            <button onClick={s.pause} className="rounded-xl bg-line py-6 text-xl font-black tracking-widest">
              PAUSE
            </button>
            <button onClick={() => setConfirmFinish(true)} className="rounded-xl bg-red py-6 text-xl font-black tracking-widest">
              FINISH
            </button>
          </>
        )}
        {s.recording === "paused" && (
          <>
            <button
              onClick={() => {
                alerts.unlock();
                void s.start();
              }}
              className="rounded-xl bg-go py-6 text-xl font-black tracking-widest text-black"
            >
              RESUME
            </button>
            <button onClick={() => setConfirmFinish(true)} className="rounded-xl bg-red py-6 text-xl font-black tracking-widest">
              FINISH
            </button>
          </>
        )}
        {s.recording === "finishing" && <div className="col-span-2 py-6 text-center font-bold text-dim">Uploading…</div>}
        {s.recording === "finished" && (
          <Link href={`/laps?session=${sessionId}`} className="col-span-2 rounded-xl bg-flag py-6 text-center text-xl font-black tracking-widest text-black">
            VIEW LAPS
          </Link>
        )}
      </div>

      {alerts.banner && (
        <button
          onClick={alerts.dismiss}
          className={`absolute inset-x-3 top-12 z-20 rounded-xl p-4 text-left text-xl leading-tight font-black shadow-2xl ${alerts.banner.level === "danger" ? "bg-red text-ink" : "bg-flag text-black"}`}
        >
          ⚠ {alerts.banner.text}
          <span className="mt-1 block text-xs font-bold opacity-70">Tap to dismiss</span>
        </button>
      )}

      {showAlertSettings && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/80 p-4" onClick={() => setShowAlertSettings(false)}>
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-panel p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-lg font-black">Safety alerts</p>
            <p className="text-xs text-dim">
              Warning beep + popup while recording: speed over your limit{s.meta.groupId ? ", a friend far behind, stopped or without signal" : ""}. Keep this
              screen open: phones stop web apps in the background.
            </p>
            <label className="flex items-center justify-between text-sm font-bold">
              Sound
              <input type="checkbox" checked={alertSettings.sound} onChange={(e) => setAlertSettings({ sound: e.target.checked })} className="h-5 w-5" />
            </label>
            <label className="flex items-center justify-between text-sm font-bold">
              Vibrate <span className="ml-1 text-xs font-normal text-dim">(Android)</span>
              <input type="checkbox" checked={alertSettings.vibrate} onChange={(e) => setAlertSettings({ vibrate: e.target.checked })} className="ml-auto h-5 w-5" />
            </label>
            <div className="space-y-2">
              <label className="flex items-center justify-between text-sm font-bold">
                Speed limit warning
                <input
                  type="checkbox"
                  checked={alertSettings.speedLimitOn}
                  onChange={(e) => setAlertSettings({ speedLimitOn: e.target.checked })}
                  className="h-5 w-5"
                />
              </label>
              <div className={alertSettings.speedLimitOn ? "" : "opacity-40"}>
                <div className="timing text-center text-3xl font-black">
                  {alertSettings.speedLimitKmh}
                  <span className="ml-1 text-sm text-dim">km/h</span>
                </div>
                <input
                  type="range"
                  min={SPEED_LIMIT_MIN}
                  max={SPEED_LIMIT_MAX}
                  step={5}
                  value={alertSettings.speedLimitKmh}
                  disabled={!alertSettings.speedLimitOn}
                  onChange={(e) => setAlertSettings({ speedLimitKmh: Number(e.target.value) })}
                  aria-label="Speed limit (km/h)"
                  className="w-full accent-flag"
                />
                <div className="flex justify-between text-[10px] text-dim">
                  <span>{SPEED_LIMIT_MIN}</span>
                  <span>{SPEED_LIMIT_MAX}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => alerts.unlock("danger")} className="rounded-lg bg-line py-3 text-sm font-bold">
                Test sound
              </button>
              <button onClick={() => setShowAlertSettings(false)} className="rounded-lg bg-flag py-3 text-sm font-black text-black">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmFinish && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-panel p-5">
            <p className="text-center text-lg font-bold">Finish session?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setConfirmFinish(false)} className="rounded-lg bg-line py-4 font-bold">
                Cancel
              </button>
              <button onClick={onFinish} className="rounded-lg bg-red py-4 font-black">
                FINISH
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Friend = { rider: ReturnType<typeof useGroupFeed>["riders"][number]; gap: RiderGap | null; stoppedMs: number };

/** Friends ordered like the road: farthest ahead on top, farthest behind at the bottom. */
function FriendStrip({ friends, now }: { friends: Friend[]; now: number }) {
  const rank = (f: Friend) => (!f.gap ? -Infinity : f.gap.position === "ahead" ? f.gap.meters : f.gap.position === "behind" ? -f.gap.meters : -1e9);
  const sorted = [...friends].sort((a, b) => rank(b) - rank(a));
  return (
    <ul className="col-span-2 divide-y divide-line rounded-lg bg-panel px-3 text-sm">
      {sorted.slice(0, 4).map(({ rider, gap, stoppedMs }) => {
        const st = riderStatus(rider, now);
        const note =
          st === "finished" ? "finished" : st === "offline" ? "no signal" : st === "waiting" ? "no GPS yet" : stoppedMs >= 30_000 ? `stopped ${Math.round(stoppedMs / 1000)} s` : null;
        return (
          <li key={rider.sessionId} className="flex items-center gap-2 py-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: rider.color }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{rider.name ?? "Rider"}</span>
            {note ? (
              <span className="text-xs font-bold text-red uppercase">{note}</span>
            ) : gap ? (
              <span className={`timing font-bold ${gap.position === "ahead" ? "text-go" : gap.position === "behind" ? "text-flag" : "text-dim"}`}>
                {gap.position === "ahead" ? "▲ " : gap.position === "behind" ? "▼ " : "~"}
                {gap.alongRoute ? formatGap(gap) : formatDistance(gap.meters)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
