import type { CleanPoint, DetectedLap, GPSQuality, LapMetrics } from "@/lib/types";
import { calculateDistance } from "./distance";
import { buildSpeedSeries, robustMaxSpeedKmh } from "./speed";
import type { SectorSplit } from "./sectorDetection";

/**
 * Points between start and end (inclusive), with interpolated boundary points at exactly
 * `start` and `end` so distance/time are not biased by the GPS update interval.
 */
export function sliceTrajectory(points: CleanPoint[], start: number, end: number): CleanPoint[] {
  const out: CleanPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (prev && !p.breakBefore) {
      if (prev.timestamp < start && p.timestamp > start) out.push(interpolate(prev, p, start));
    }
    if (p.timestamp >= start && p.timestamp <= end) {
      out.push(out.length === 0 ? { ...p, breakBefore: false } : p);
    }
    if (prev && !p.breakBefore && prev.timestamp < end && p.timestamp > end) {
      out.push(interpolate(prev, p, end));
      break;
    }
    if (p.timestamp > end) break;
  }
  return out;
}

function interpolate(a: CleanPoint, b: CleanPoint, ts: number): CleanPoint {
  const t = (ts - a.timestamp) / (b.timestamp - a.timestamp);
  const lerp = (x: number, y: number) => x + t * (y - x);
  return {
    timestamp: ts,
    latitude: lerp(a.latitude, b.latitude),
    longitude: lerp(a.longitude, b.longitude),
    speed: a.speed != null && b.speed != null ? lerp(a.speed, b.speed) : null,
    accuracy: Math.max(a.accuracy, b.accuracy),
    altitude: a.altitude != null && b.altitude != null ? lerp(a.altitude, b.altitude) : null,
    heading: null,
    lowQuality: a.lowQuality || b.lowQuality,
    breakBefore: false,
  };
}

export function calculateGpsQuality(points: CleanPoint[]): GPSQuality {
  const n = points.length;
  if (n === 0) {
    return { pointCount: 0, lowQualityCount: 0, meanAccuracyMeters: null, medianIntervalMs: null, maxGapMs: 0, speedFromDevicePct: 0, rating: "poor" };
  }
  const lowQualityCount = points.filter((p) => p.lowQuality).length;
  const accs = points.map((p) => p.accuracy).filter(Number.isFinite);
  const meanAccuracyMeters = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null;
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push(points[i]!.timestamp - points[i - 1]!.timestamp);
  intervals.sort((a, b) => a - b);
  const medianIntervalMs = intervals.length ? intervals[Math.floor(intervals.length / 2)]! : null;
  const maxGapMs = intervals.length ? intervals[intervals.length - 1]! : 0;
  const speedFromDevicePct = Math.round((points.filter((p) => p.speed != null).length / n) * 100);
  const lowPct = (lowQualityCount / n) * 100;

  let rating: GPSQuality["rating"] = "medium";
  if ((meanAccuracyMeters ?? 99) <= 8 && lowPct < 10 && maxGapMs <= 2000) rating = "good";
  if ((meanAccuracyMeters ?? 99) > 20 || lowPct > 30 || maxGapMs > 5000 || n < 10) rating = "poor";

  return { pointCount: n, lowQualityCount, meanAccuracyMeters: round(meanAccuracyMeters, 1), medianIntervalMs, maxGapMs, speedFromDevicePct, rating };
}

/** Core per-lap numbers. Pure: same input -> same output. */
export function calculateLapMetrics(
  sessionPoints: CleanPoint[],
  lap: Pick<DetectedLap, "startTime" | "endTime" | "isTimed">,
  sectorSplits: SectorSplit[] = [],
): LapMetrics {
  const slice = sliceTrajectory(sessionPoints, lap.startTime, lap.endTime);
  let distanceMeters = 0;
  for (let i = 1; i < slice.length; i++) {
    if (!slice[i]!.breakBefore) distanceMeters += calculateDistance(slice[i - 1]!, slice[i]!);
  }
  const lapTimeMs = Math.round(lap.endTime - lap.startTime);
  const series = buildSpeedSeries(slice);
  const sectorTimes: Record<string, number | null> = {};
  for (const s of sectorSplits) sectorTimes[s.sectorId] = s.timeMs == null ? null : Math.round(s.timeMs);

  return {
    lapTimeMs,
    distanceMeters: round(distanceMeters, 1)!,
    maxSpeedKmh: round(robustMaxSpeedKmh(series), 1)!,
    averageSpeedKmh: lapTimeMs > 0 ? round((distanceMeters / (lapTimeMs / 1000)) * 3.6, 1)! : 0,
    sectorTimes,
    gpsQuality: calculateGpsQuality(sessionPoints.filter((p) => p.timestamp >= lap.startTime && p.timestamp <= lap.endTime)),
  };
}

function round(v: number | null, dp: number): number | null {
  if (v == null || !Number.isFinite(v)) return v;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
