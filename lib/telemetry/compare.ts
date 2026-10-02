import type { CleanPoint, CornerDefinition, LapMetrics } from "@/lib/types";
import { buildSpeedSeries, type SpeedSample } from "./speed";
import { analyzeCorner } from "./corners";

export type LapForCompare = {
  id: string;
  lapNumber: number;
  metrics: LapMetrics;
  /** Lap-sliced clean points (see sliceTrajectory). */
  points: CleanPoint[];
};

export type SegmentDelta = {
  /** Fraction of lap distance, 0..1. */
  fromPct: number;
  toPct: number;
  /** Time B minus time A over this segment (ms). Negative = B faster. */
  deltaMs: number;
  avgSpeedDeltaKmh: number | null;
};

export type LapComparison = {
  convention: "All deltas are B minus A. Negative time = B is faster.";
  lapA: { id: string; lapNumber: number; lapTimeMs: number };
  lapB: { id: string; lapNumber: number; lapTimeMs: number };
  lapTimeDeltaMs: number;
  sectorDeltasMs: Record<string, number | null>;
  maxSpeedDeltaKmh: number;
  averageSpeedDeltaKmh: number;
  distanceDeltaMeters: number;
  /** Lap split into N equal-distance segments (normalized, so different lines still align). */
  segments: SegmentDelta[];
  biggestGainsForB: SegmentDelta[];
  biggestLossesForB: SegmentDelta[];
  corners: Array<{
    cornerId: string;
    entrySpeedDeltaKmh: number | null;
    minSpeedDeltaKmh: number | null;
    exitSpeedDeltaKmh: number | null;
    timeDeltaMs: number | null;
  }>;
  dataQuality: { a: LapMetrics["gpsQuality"]["rating"]; b: LapMetrics["gpsQuality"]["rating"]; note: string };
};

const SEGMENTS = 20;

/** Elapsed time (ms from lap start) at a normalized distance fraction. */
function elapsedAtFraction(series: SpeedSample[], frac: number): number | null {
  if (series.length < 2) return null;
  const total = series[series.length - 1]!.distance;
  const d = frac * total;
  const t0 = series[0]!.timestamp;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (d >= a.distance && d <= b.distance) {
      const span = b.distance - a.distance;
      const t = span > 0 ? (d - a.distance) / span : 0;
      return a.timestamp + t * (b.timestamp - a.timestamp) - t0;
    }
  }
  return null;
}

export function compareLaps(a: LapForCompare, b: LapForCompare, corners: CornerDefinition[] = []): LapComparison {
  const sa = buildSpeedSeries(a.points);
  const sb = buildSpeedSeries(b.points);

  const sectorIds = new Set([...Object.keys(a.metrics.sectorTimes), ...Object.keys(b.metrics.sectorTimes)]);
  const sectorDeltasMs: Record<string, number | null> = {};
  for (const id of sectorIds) {
    const ta = a.metrics.sectorTimes[id];
    const tb = b.metrics.sectorTimes[id];
    sectorDeltasMs[id] = ta != null && tb != null ? tb - ta : null;
  }

  const segments: SegmentDelta[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const f0 = i / SEGMENTS;
    const f1 = (i + 1) / SEGMENTS;
    const a0 = elapsedAtFraction(sa, f0);
    const a1 = elapsedAtFraction(sa, f1);
    const b0 = elapsedAtFraction(sb, f0);
    const b1 = elapsedAtFraction(sb, f1);
    if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
    const segLenA = (sa[sa.length - 1]!.distance * (f1 - f0)) / 1000;
    const segLenB = (sb[sb.length - 1]!.distance * (f1 - f0)) / 1000;
    const vA = a1 > a0 ? segLenA / ((a1 - a0) / 3_600_000) : null;
    const vB = b1 > b0 ? segLenB / ((b1 - b0) / 3_600_000) : null;
    segments.push({
      fromPct: Math.round(f0 * 100),
      toPct: Math.round(f1 * 100),
      deltaMs: Math.round(b1 - b0 - (a1 - a0)),
      avgSpeedDeltaKmh: vA != null && vB != null ? Math.round(vB - vA) : null,
    });
  }
  const sorted = [...segments].sort((x, y) => x.deltaMs - y.deltaMs);

  return {
    convention: "All deltas are B minus A. Negative time = B is faster.",
    lapA: { id: a.id, lapNumber: a.lapNumber, lapTimeMs: a.metrics.lapTimeMs },
    lapB: { id: b.id, lapNumber: b.lapNumber, lapTimeMs: b.metrics.lapTimeMs },
    lapTimeDeltaMs: b.metrics.lapTimeMs - a.metrics.lapTimeMs,
    sectorDeltasMs,
    maxSpeedDeltaKmh: Math.round((b.metrics.maxSpeedKmh - a.metrics.maxSpeedKmh) * 10) / 10,
    averageSpeedDeltaKmh: Math.round((b.metrics.averageSpeedKmh - a.metrics.averageSpeedKmh) * 10) / 10,
    distanceDeltaMeters: Math.round(b.metrics.distanceMeters - a.metrics.distanceMeters),
    segments,
    biggestGainsForB: sorted.filter((s) => s.deltaMs < 0).slice(0, 3),
    biggestLossesForB: sorted.filter((s) => s.deltaMs > 0).reverse().slice(0, 3),
    corners: corners.map((c) => {
      const ca = analyzeCorner(a.points, c);
      const cb = analyzeCorner(b.points, c);
      const d = (x: number | null, y: number | null) => (x != null && y != null ? y - x : null);
      return {
        cornerId: c.id,
        entrySpeedDeltaKmh: d(ca.entrySpeedKmh.value, cb.entrySpeedKmh.value),
        minSpeedDeltaKmh: d(ca.minimumSpeedKmh.value, cb.minimumSpeedKmh.value),
        exitSpeedDeltaKmh: d(ca.exitSpeedKmh.value, cb.exitSpeedKmh.value),
        timeDeltaMs: d(ca.timeThroughCornerMs.value, cb.timeThroughCornerMs.value),
      };
    }),
    dataQuality: {
      a: a.metrics.gpsQuality.rating,
      b: b.metrics.gpsQuality.rating,
      note: "Distance-normalized segments assume both laps follow the same path; with phone GPS, deltas under ~0.1 s per segment are within noise.",
    },
  };
}
