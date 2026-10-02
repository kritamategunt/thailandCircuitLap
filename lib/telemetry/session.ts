import type { CleanPoint, DetectedLap, GPSPoint, GPSQuality, LapMetrics, LineCrossing, TrackDefinition } from "@/lib/types";
import { sanitizePoints } from "./quality";
import { detectLaps } from "./lapDetection";
import { findSectorCrossings, splitLapIntoSectors, type SectorSplit } from "./sectorDetection";
import { calculateGpsQuality, calculateLapMetrics } from "./metrics";
import type { TelemetryOptions } from "./config";

export type ProcessedLap = DetectedLap & { sectors: SectorSplit[]; metrics: LapMetrics };

export type SessionSummary = {
  totalLaps: number;
  timedLaps: number;
  bestLap: { lapNumber: number; lapTimeMs: number } | null;
  averageLapTimeMs: number | null;
  /** Std-dev of timed laps (ms). Lower = more consistent. */
  consistencyStdDevMs: number | null;
  /** Sum of best individual sectors across timed laps (calculated, not driven). */
  theoreticalBestMs: number | null;
  bestSectors: Record<string, { lapNumber: number; timeMs: number } | null>;
  maxSpeedKmh: number;
  gpsQuality: GPSQuality;
  pointCount: number;
  droppedJumps: number;
};

export type ProcessedSession = {
  points: CleanPoint[];
  crossings: LineCrossing[];
  laps: ProcessedLap[];
  summary: SessionSummary;
};

/** Full pipeline: raw fixes -> clean trajectory -> laps -> sectors -> metrics -> summary. */
export function processSession(raw: GPSPoint[], track: TrackDefinition, opts?: Partial<TelemetryOptions>): ProcessedSession {
  const { points, droppedJumps } = sanitizePoints(raw, opts);
  const { crossings, laps: detected } = detectLaps(points, track, opts);
  const sectorCrossings = findSectorCrossings(points, track);
  const laps: ProcessedLap[] = detected.map((lap) => {
    const sectors = splitLapIntoSectors(lap, track, sectorCrossings);
    return { ...lap, sectors, metrics: calculateLapMetrics(points, lap, sectors) };
  });
  return { points, crossings, laps, summary: summarize(laps, points, track, droppedJumps) };
}

export function summarize(laps: ProcessedLap[], points: CleanPoint[], track: TrackDefinition, droppedJumps = 0): SessionSummary {
  const timed = laps.filter((l) => l.isTimed);
  const times = timed.map((l) => l.metrics.lapTimeMs);
  const best = timed.reduce<ProcessedLap | null>((b, l) => (!b || l.metrics.lapTimeMs < b.metrics.lapTimeMs ? l : b), null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const std = times.length > 1 && avg != null ? Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / (times.length - 1)) : null;

  const bestSectors: SessionSummary["bestSectors"] = {};
  for (const s of track.sectors) {
    let bestS: { lapNumber: number; timeMs: number } | null = null;
    for (const l of timed) {
      const t = l.metrics.sectorTimes[s.id];
      if (t != null && (!bestS || t < bestS.timeMs)) bestS = { lapNumber: l.lapNumber, timeMs: t };
    }
    bestSectors[s.id] = bestS;
  }
  const sectorBests = Object.values(bestSectors);
  const theoreticalBestMs = sectorBests.length && sectorBests.every((b) => b) ? sectorBests.reduce((a, b) => a + b!.timeMs, 0) : null;

  return {
    totalLaps: laps.length,
    timedLaps: timed.length,
    bestLap: best ? { lapNumber: best.lapNumber, lapTimeMs: best.metrics.lapTimeMs } : null,
    averageLapTimeMs: avg == null ? null : Math.round(avg),
    consistencyStdDevMs: std == null ? null : Math.round(std),
    theoreticalBestMs,
    bestSectors,
    maxSpeedKmh: laps.reduce((m, l) => Math.max(m, l.metrics.maxSpeedKmh), 0),
    gpsQuality: calculateGpsQuality(points),
    pointCount: points.length,
    droppedJumps,
  };
}
