"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RideAlert } from "@/lib/telemetry/rideSafety";

const SETTINGS_KEY = "tc.rideAlerts.v2";
/** Same alert repeats at most this often while its condition holds. */
const REPEAT_MS = 3 * 60_000;
const SPEED_REPEAT_MS = 30_000;
const BANNER_MS = 8_000;

export type AlertSettings = { sound: boolean; vibrate: boolean; speedLimitOn: boolean; speedLimitKmh: number };

/** Beep pattern per level: danger = 3 high beeps, warn = 2 lower ones. Short and distinct from music/navigation voices. */
const BEEPS: Record<RideAlert["level"], { hz: number; count: number }> = { danger: { hz: 1320, count: 3 }, warn: { hz: 880, count: 2 } };

let audio: AudioContext | null = null;

function beep(level: RideAlert["level"]) {
  if (!audio) return;
  const { hz, count } = BEEPS[level];
  const t0 = audio.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = hz;
    const t = t0 + i * 0.22;
    // Quick fade in/out so the beep doesn't click.
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.01);
    gain.gain.setValueAtTime(0.35, t + 0.14);
    gain.gain.linearRampToValueAtTime(0, t + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  }
}

function loadSettings(defaults: AlertSettings): AlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<AlertSettings>) : {};
    return { ...defaults, ...saved, speedLimitKmh: typeof saved.speedLimitKmh === "number" ? saved.speedLimitKmh : defaults.speedLimitKmh };
  } catch {
    return defaults;
  }
}

/** Alert preferences, remembered on this device. Pass a stable (memoized) `defaults`. */
export function useAlertSettings(defaults: AlertSettings) {
  const [settings, setSettingsState] = useState<AlertSettings>(defaults);
  useEffect(() => setSettingsState(loadSettings(defaults)), [defaults]);

  const setSettings = useCallback((patch: Partial<AlertSettings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  return { settings, setSettings };
}

/**
 * Turns active RideAlerts into something a rider notices: a warning beep, a vibration (Android;
 * iOS Safari has no vibration API) and a popup. Each alert fires when it first
 * appears, then repeats only every few minutes while it stays active.
 */
export function useRideAlerts(alerts: RideAlert[], { enabled, settings }: { enabled: boolean; settings: AlertSettings }) {
  const [banner, setBanner] = useState<RideAlert | null>(null);
  const lastFired = useRef(new Map<string, number>());

  /** Browsers (iOS especially) only allow audio after a user gesture: call from the START tap. `test` plays a sample beep. */
  const unlock = useCallback((test?: RideAlert["level"]) => {
    try {
      audio ??= new AudioContext();
      void audio.resume();
      if (test) beep(test);
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const active = new Set(alerts.map((a) => a.key));
    // Condition cleared -> forget it, so it fires again immediately if it comes back.
    for (const k of lastFired.current.keys()) if (!active.has(k)) lastFired.current.delete(k);
    const due = alerts.filter((a) => {
      const last = lastFired.current.get(a.key);
      return last == null || now - last >= (a.key === "speed" ? SPEED_REPEAT_MS : REPEAT_MS);
    });
    if (due.length === 0) return;
    // Most urgent first: one beep + popup for the batch, so several alerts don't stack noise.
    due.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
    for (const a of due) lastFired.current.set(a.key, now);
    setBanner(due[0]!);
    if (settings.vibrate) navigator.vibrate?.(due[0]!.level === "danger" ? [300, 120, 300, 120, 300] : [200, 100, 200]);
    if (settings.sound) beep(due[0]!.level);
  }, [alerts, enabled, settings.sound, settings.vibrate]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner]);

  return { banner, dismiss: () => setBanner(null), unlock };
}
