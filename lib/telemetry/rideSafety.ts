import type { RiderGap } from "./groupGap";

/**
 * Safety alert rules for riding with friends (pure: the UI handles sound, vibration and repeats).
 * Phone GPS can't judge following distance or closing speed reliably, so rules stick to what it
 * can: speed vs a limit the rider chose, and friends falling behind, stopping or going silent.
 */
export const RIDE_SAFETY = {
  FAR_BEHIND_M: 1000,
  FAR_BEHIND_S: 60,
  /** Straight-line distance (no shared road) that counts as separated. */
  FAR_AWAY_M: 2000,
  STOPPED_MS: 60_000,
  NO_SIGNAL_MS: 120_000,
};

export type FriendState = {
  id: string;
  name: string;
  gap: RiderGap | null;
  stoppedMs: number;
  /** ms since their newest fix; null when they never sent one. */
  signalAgeMs: number | null;
  finished: boolean;
};

export type RideAlert = {
  /** Stable while the condition holds — used to avoid repeating the same alert. */
  key: string;
  level: "warn" | "danger";
  text: string;
};

export function rideAlerts(input: { mySpeedKmh: number | null; speedLimitKmh: number | null; friends: FriendState[] }): RideAlert[] {
  const out: RideAlert[] = [];
  const { mySpeedKmh, speedLimitKmh } = input;
  if (speedLimitKmh != null && mySpeedKmh != null && mySpeedKmh > speedLimitKmh)
    out.push({ key: "speed", level: "danger", text: `Slow down: ${Math.round(mySpeedKmh)} km/h, your limit is ${speedLimitKmh}` });

  for (const f of input.friends) {
    if (f.finished) continue;
    if (f.signalAgeMs != null && f.signalAgeMs >= RIDE_SAFETY.NO_SIGNAL_MS) {
      out.push({ key: `signal:${f.id}`, level: "danger", text: `No signal from ${f.name} for ${minutes(f.signalAgeMs)}` });
      continue; // a stale position says nothing about gap or stopping
    }
    if (f.stoppedMs >= RIDE_SAFETY.STOPPED_MS) {
      out.push({ key: `stopped:${f.id}`, level: "danger", text: `${f.name} has stopped for ${minutes(f.stoppedMs)}, check on them` });
      continue;
    }
    const g = f.gap;
    if (!g) continue;
    if (g.position === "behind" && (g.meters >= RIDE_SAFETY.FAR_BEHIND_M || (g.seconds ?? 0) >= RIDE_SAFETY.FAR_BEHIND_S))
      out.push({ key: `behind:${f.id}`, level: "warn", text: `${f.name} is ${formatGap(g)} behind, consider waiting` });
    else if (!g.alongRoute && g.meters >= RIDE_SAFETY.FAR_AWAY_M)
      out.push({ key: `away:${f.id}`, level: "warn", text: `${f.name} is ${formatDistance(g.meters)} away` });
  }
  return out;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

/** "350 m · 12 s" along the road, "1.2 km" straight line. */
export function formatGap(g: RiderGap): string {
  return g.seconds != null && g.alongRoute ? `${formatDistance(g.meters)} · ${Math.round(g.seconds)} s` : formatDistance(g.meters);
}

function minutes(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return min <= 1 ? "1 minute" : `${min} minutes`;
}
