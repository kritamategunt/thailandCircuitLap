"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RideAlert } from "@/lib/telemetry/rideSafety";

const SETTINGS_KEY = "tc.rideAlerts";
/** Same alert repeats at most this often while its condition holds. */
const REPEAT_MS = 3 * 60_000;
const SPEED_REPEAT_MS = 30_000;
const BANNER_MS = 8_000;

export type AlertSettings = { voice: boolean; vibrate: boolean; speedLimitKmh: number | null };

function loadSettings(defaults: AlertSettings): AlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<AlertSettings>) } : defaults;
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
 * Turns active RideAlerts into something a rider notices without looking: spoken text, a vibration
 * (Android; iOS Safari has no vibration API) and a big banner. Each alert fires when it first
 * appears, then repeats only every few minutes while it stays active.
 */
export function useRideAlerts(alerts: RideAlert[], { enabled, settings }: { enabled: boolean; settings: AlertSettings }) {
  const [banner, setBanner] = useState<RideAlert | null>(null);
  const lastFired = useRef(new Map<string, number>());

  /** iOS only lets a page speak after a user gesture: call from the START tap (or a test button, with `text`). */
  const unlock = useCallback((text = " ") => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (text === " ") u.volume = 0;
      speechSynthesis.speak(u);
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
    // Most urgent first; speak them as one queue so they don't talk over each other.
    due.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
    for (const a of due) lastFired.current.set(a.key, now);
    setBanner(due[0]!);
    if (settings.vibrate) navigator.vibrate?.(due[0]!.level === "danger" ? [300, 120, 300, 120, 300] : [200, 100, 200]);
    if (settings.voice && "speechSynthesis" in window) for (const a of due) speechSynthesis.speak(new SpeechSynthesisUtterance(a.text));
  }, [alerts, enabled, settings.voice, settings.vibrate]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner]);

  return { banner, dismiss: () => setBanner(null), unlock };
}
