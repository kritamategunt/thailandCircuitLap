"use client";
import type { GPSPoint } from "@/lib/types";

export type GpsStatus = "idle" | "requesting" | "active" | "signal-lost" | "denied" | "unavailable" | "unsupported" | "error";

const SIGNAL_LOST_AFTER_MS = 5_000;

/**
 * Thin wrapper over navigator.geolocation.watchPosition.
 * Uses the DEVICE fix timestamp (position.timestamp), never Date.now().
 * Does not assume a fixed update rate.
 */
export class GpsTracker {
  private watchId: number | null = null;
  private lastFixAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private status: GpsStatus = "idle";

  constructor(
    private readonly onPoint: (p: GPSPoint) => void,
    private readonly onStatus: (s: GpsStatus, message?: string) => void,
  ) {}

  get isRunning() {
    return this.watchId != null;
  }

  start() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      this.setStatus("unsupported", "This browser has no Geolocation API");
      return;
    }
    if (this.watchId != null) return;
    this.setStatus("requesting");
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastFixAt = Date.now();
        if (this.status !== "active") this.setStatus("active");
        const c = pos.coords;
        this.onPoint({
          timestamp: pos.timestamp,
          latitude: c.latitude,
          longitude: c.longitude,
          speed: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
          accuracy: c.accuracy,
          altitude: c.altitude ?? null,
          heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.setStatus("denied", "Location permission denied. Enable it in browser settings.");
          this.stop(false);
        } else if (err.code === err.POSITION_UNAVAILABLE) this.setStatus("unavailable", err.message);
        else if (err.code === err.TIMEOUT) this.setStatus("signal-lost", "Waiting for GPS fix…");
        else this.setStatus("error", err.message);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    this.watchdog = setInterval(() => {
      if (this.status === "active" && Date.now() - this.lastFixAt > SIGNAL_LOST_AFTER_MS) this.setStatus("signal-lost");
    }, 1_000);
  }

  stop(resetStatus = true) {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    if (resetStatus) this.setStatus("idle");
  }

  private setStatus(s: GpsStatus, msg?: string) {
    this.status = s;
    this.onStatus(s, msg);
  }
}

/** Keep the screen awake while recording (GPS often stops when the phone locks). */
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    return nav.wakeLock ? await nav.wakeLock.request("screen") : null;
  } catch {
    return null;
  }
}
