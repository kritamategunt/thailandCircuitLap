import type { CleanPoint } from "@/lib/types";
import { calculateDistance } from "./distance";

export const msToKmh = (ms: number) => ms * 3.6;

export type SpeedSample = {
  timestamp: number;
  /** Cumulative distance from the start of the slice, meters. */
  distance: number;
  speedKmh: number | null;
  /** true = device-measured Doppler speed; false = derived from position change (noisier). */
  measured: boolean;
  latitude: number;
  longitude: number;
  accuracy: number;
};

/**
 * Speed + cumulative distance for each point.
 * Prefer device speed (Doppler, measured). If null, derive from neighbouring fixes
 * (central difference), never across a trajectory break.
 */
export function buildSpeedSeries(points: CleanPoint[]): SpeedSample[] {
  const out: SpeedSample[] = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (i > 0 && !p.breakBefore) dist += calculateDistance(points[i - 1]!, p);
    let speedKmh: number | null = null;
    let measured = false;
    if (p.speed != null && Number.isFinite(p.speed) && p.speed >= 0) {
      speedKmh = msToKmh(p.speed);
      measured = true;
    } else {
      speedKmh = derivedSpeedKmh(points, i);
    }
    out.push({ timestamp: p.timestamp, distance: dist, speedKmh, measured, latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy });
  }
  return out;
}

function derivedSpeedKmh(points: CleanPoint[], i: number): number | null {
  const p = points[i]!;
  const prev = i > 0 && !p.breakBefore ? points[i - 1]! : null;
  const nextRaw = points[i + 1];
  const next = nextRaw && !nextRaw.breakBefore ? nextRaw : null;
  const a = prev ?? p;
  const b = next ?? p;
  if (a === b) return null;
  const dt = (b.timestamp - a.timestamp) / 1000;
  if (dt <= 0) return null;
  const d = (prev ? calculateDistance(prev, p) : 0) + (next ? calculateDistance(p, next) : 0);
  return msToKmh(d / dt);
}

/** 3-sample median filter — removes single-sample spikes without smearing peaks much. */
export function medianFilter3(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    const w = [values[i - 1], v, values[i + 1]].filter((x): x is number => x != null);
    if (v == null || w.length < 3) return v;
    w.sort((a, b) => a - b);
    return w[1]!;
  });
}

/** Robust max speed: max of the median-filtered series (rejects 1-sample GPS spikes). */
export function robustMaxSpeedKmh(series: SpeedSample[]): number {
  const filtered = medianFilter3(series.map((s) => s.speedKmh));
  let max = 0;
  for (const v of filtered) if (v != null && v > max) max = v;
  return max;
}

/** Linear interpolation of speed at a cumulative distance. */
export function speedAtDistance(series: SpeedSample[], d: number): number | null {
  if (series.length === 0) return null;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (d >= a.distance && d <= b.distance) {
      if (a.speedKmh == null || b.speedKmh == null) return a.speedKmh ?? b.speedKmh;
      const span = b.distance - a.distance;
      const t = span > 0 ? (d - a.distance) / span : 0;
      return a.speedKmh + t * (b.speedKmh - a.speedKmh);
    }
  }
  return null;
}
