"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GPSPoint, TrackDefinition } from "@/lib/types";
import { getTrack } from "@/tracks";
import { LiveLapTimer, initialLiveState, type LiveState } from "@/lib/telemetry/liveTimer";
import { startLineAt, travelHeading, withStartFinish } from "@/lib/telemetry/freeRoad";
import { GpsTracker, requestWakeLock, type GpsStatus } from "@/lib/client/gpsTracker";
import { UploadQueue, type QueueStatus } from "@/lib/client/uploadQueue";
import { getSessionMeta, getSessionPoints, saveSessionMeta, savePoint, type LocalSessionMeta } from "@/lib/client/localStore";

/** Points kept in memory for the live map trail (~10 min at 1 Hz). */
const TRAIL_POINTS = 600;

export type RecordingState = "idle" | "recording" | "paused" | "finishing" | "finished";

/**
 * Orchestrates the live pipeline (no business logic here):
 *   GpsTracker -> IndexedDB (local buffer) -> UploadQueue -> server
 *              -> LiveLapTimer (pure) -> UI state
 */
export function useLiveSession(sessionId: string) {
  const [meta, setMeta] = useState<LocalSessionMeta | null | undefined>(undefined);
  const [recording, setRecording] = useState<RecordingState>("idle");
  const [gps, setGps] = useState<{ status: GpsStatus; message?: string }>({ status: "idle" });
  const [live, setLive] = useState<LiveState>(initialLiveState);
  const [queue, setQueue] = useState<QueueStatus>({ pending: 0, online: true, lastError: null, lastUploadAt: null });
  const [hidden, setHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [trail, setTrail] = useState<GPSPoint[]>([]);

  const trackerRef = useRef<GpsTracker | null>(null);
  const timerRef = useRef<LiveLapTimer | null>(null);
  const queueRef = useRef<UploadQueue | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const lastStored = useRef(0);

  // Boot: load local meta, replay buffered points (survives reload), start draining the queue.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getSessionMeta(sessionId);
      if (cancelled) return;
      setMeta(m ?? null);
      if (!m) return;
      const track = sessionTrack(m);
      if (!track) return;
      const stored = await getSessionPoints(sessionId);
      const timer = new LiveLapTimer(track);
      for (const p of stored) timer.feed(p);
      timerRef.current = timer;
      setLive(timer.getState());
      setTrail(stored.slice(-TRAIL_POINTS));
      if (m.status === "completed") setRecording("finished");
      else if (timer.getState().pointCount > 0) setRecording("paused");
      const q = new UploadQueue(sessionId, setQueue);
      queueRef.current = q;
      q.start();
    })();
    return () => {
      cancelled = true;
      queueRef.current?.stop();
      trackerRef.current?.stop();
      void wakeRef.current?.release().catch(() => {});
    };
  }, [sessionId]);

  // Clock for the running lap display.
  useEffect(() => {
    if (recording !== "recording") return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [recording]);

  // Background-tab handling: browsers throttle/stop GPS when hidden or locked.
  useEffect(() => {
    const onVis = async () => {
      const isHidden = document.visibilityState === "hidden";
      setHidden(isHidden);
      if (!isHidden && recording === "recording") wakeRef.current = await requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [recording]);

  const onPoint = useCallback(
    (p: GPSPoint) => {
      // 1) persist first — never lose a fix
      if (p.timestamp > lastStored.current) {
        lastStored.current = p.timestamp;
        void savePoint(sessionId, p);
      }
      // 2) live timing + map trail
      const t = timerRef.current;
      if (t) setLive(t.feed(p));
      setTrail((tr) => (tr.length >= TRAIL_POINTS ? [...tr.slice(1 - TRAIL_POINTS), p] : [...tr, p]));
    },
    [sessionId],
  );

  const start = useCallback(async () => {
    if (!meta) return;
    if (!trackerRef.current) trackerRef.current = new GpsTracker(onPoint, (status, message) => setGps({ status, message }));
    trackerRef.current.start();
    wakeRef.current = await requestWakeLock();
    setRecording("recording");
  }, [meta, onPoint]);

  const pause = useCallback(() => {
    trackerRef.current?.stop();
    void wakeRef.current?.release().catch(() => {});
    setRecording("paused");
  }, []);

  /** Returns true when the server confirmed; false = queued, will finish when back online. */
  const finish = useCallback(async (): Promise<boolean> => {
    if (!meta) return false;
    trackerRef.current?.stop();
    void wakeRef.current?.release().catch(() => {});
    setRecording("finishing");
    const updated: LocalSessionMeta = { ...meta, finishPending: true };
    await saveSessionMeta(updated);
    setMeta(updated);
    const done = (await queueRef.current?.flush()) ?? false;
    const after = await getSessionMeta(sessionId);
    if (after) setMeta(after);
    setRecording("finished");
    return done && !after?.finishPending;
  }, [meta, sessionId]);

  /**
   * Free Road: drop the start/finish line at the current position, across the travel direction.
   * Re-times everything recorded so far. Returns an error message when it can't be placed yet.
   */
  const setStartFinishHere = useCallback(async (): Promise<string | null> => {
    if (!meta) return "Session not loaded";
    const last = trail[trail.length - 1];
    if (!last || Date.now() - last.timestamp > 10_000) return "No recent GPS fix — wait for GPS ON";
    const heading = travelHeading(last, trail.slice(-30, -1));
    if (heading == null) return "Ride a few meters first so the direction is known";
    const updated: LocalSessionMeta = { ...meta, startFinish: startLineAt(last, heading), startFinishPending: true };
    await saveSessionMeta(updated);
    setMeta(updated);
    const timer = new LiveLapTimer(sessionTrack(updated)!);
    for (const p of await getSessionPoints(sessionId)) timer.feed(p);
    timerRef.current = timer;
    setLive(timer.getState());
    void queueRef.current?.flush();
    return null;
  }, [meta, trail, sessionId]);

  const track = meta ? sessionTrack(meta) : undefined;

  const currentLapMs =
    live.currentLapStart == null ? null : Math.max(0, (recording === "recording" ? now : live.lastFixTime ?? now) - live.currentLapStart);

  return { meta, track, recording, gps, live, queue, hidden, currentLapMs, trail, start, pause, finish, setStartFinishHere };
}

function sessionTrack(m: LocalSessionMeta): TrackDefinition | undefined {
  const t = getTrack(m.trackId);
  return t && withStartFinish(t, m.startFinish);
}
