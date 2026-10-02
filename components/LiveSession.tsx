"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLiveSession } from "@/hooks/useLiveSession";
import { formatLapTime } from "@/lib/telemetry/analysis";
import { classifyAccuracy } from "@/lib/telemetry/quality";
import { getTrack } from "@/tracks";

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

  const track = getTrack(s.meta.trackId);
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

      {track && !track.verified && (
        <div className="bg-flag/15 px-4 py-1 text-center text-[11px] font-semibold text-flag">Track not calibrated — recording only, no lap detection</div>
      )}
      {s.gps.status === "denied" && <div className="bg-red/20 px-4 py-2 text-center text-sm text-red">{s.gps.message}</div>}
      {s.hidden && s.recording === "recording" && (
        <div className="bg-red/20 px-4 py-1 text-center text-xs text-red">Keep this screen open — GPS may pause in background</div>
      )}

      {/* timing */}
      <div className="grid flex-1 grid-rows-[auto_1fr_auto] gap-2 px-4 py-3">
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
        </div>
      </div>

      {finishNote && <div className="px-4 pb-2 text-center text-sm text-flag">{finishNote}</div>}

      {/* controls — big, thumb-sized */}
      <div className="grid grid-cols-2 gap-3 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {s.recording === "idle" && (
          <button onClick={s.start} className="col-span-2 rounded-xl bg-go py-6 text-2xl font-black tracking-widest text-black">
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
            <button onClick={s.start} className="rounded-xl bg-go py-6 text-xl font-black tracking-widest text-black">
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
