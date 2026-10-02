import type { CornerDefinition, LapMetrics } from "@/lib/types";
import { compareLaps, type LapComparison, type LapForCompare } from "./compare";
import { analyzeCorner, type CornerData } from "./corners";
import type { SessionSummary } from "./session";

/**
 * Structured, LLM-ready analysis of one lap. Every number is labelled with its provenance:
 *  measured   – straight from the device (lap time crossings are interpolated, so "calculated")
 *  calculated – deterministic maths on measured data
 *  estimated  – inferred (braking zones, etc.), always with a range + confidence
 * Interpretation is left to the AI, which must keep these labels.
 */
export type LapAnalysis = {
  lap: { id: string; lapNumber: number; isTimed: boolean };
  lapTime: number; // seconds, calculated
  lapTimeFormatted: string;
  bestLapDifference: number | null; // seconds vs session best (calculated)
  theoreticalBestDifference: number | null;
  strongSectors: Array<{ sectorId: string; timeMs: number; deltaToBestMs: number }>;
  weakSectors: Array<{ sectorId: string; timeMs: number; deltaToBestMs: number }>;
  potentialTimeLoss: Array<{ where: string; approxMs: number; basis: "calculated" | "estimated" }>;
  comparisonToBest: LapComparison | null;
  corners: CornerData[];
  speed: { maxKmh: number; averageKmh: number };
  sessionContext: {
    timedLaps: number;
    bestLapMs: number | null;
    averageLapMs: number | null;
    consistencyStdDevMs: number | null;
  };
  dataQuality: LapMetrics["gpsQuality"]["rating"];
  dataQualityDetail: LapMetrics["gpsQuality"];
  provenance: Record<string, "measured" | "calculated" | "estimated">;
  caveats: string[];
};

export function formatLapTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--.---";
  const neg = ms < 0;
  const abs = Math.abs(Math.round(ms));
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const msPart = abs % 1000;
  return `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}.${String(msPart).padStart(3, "0")}`;
}

export function formatDelta(ms: number | null | undefined, dp = 2): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = ms / 1000;
  return `${s > 0 ? "+" : s < 0 ? "−" : "±"}${Math.abs(s).toFixed(dp)}`;
}

export function analyzeLap(
  lap: LapForCompare & { isTimed: boolean },
  best: LapForCompare | null,
  summary: SessionSummary,
  corners: CornerDefinition[],
): LapAnalysis {
  const m = lap.metrics;
  const caveats: string[] = [
    "Source is phone GPS (typically 1 Hz, ±3–10 m). Not equivalent to motorsport telemetry.",
    "Braking/acceleration locations are inferred from speed only (no brake, throttle or IMU channels).",
  ];
  if (!lap.isTimed) caveats.push("This is an out/in lap — not a complete timed lap.");
  if (m.gpsQuality.rating !== "good") caveats.push(`GPS quality for this lap is ${m.gpsQuality.rating}; treat small differences as noise.`);

  const strong: LapAnalysis["strongSectors"] = [];
  const weak: LapAnalysis["weakSectors"] = [];
  const loss: LapAnalysis["potentialTimeLoss"] = [];
  for (const [sid, t] of Object.entries(m.sectorTimes)) {
    const b = summary.bestSectors[sid];
    if (t == null || !b) continue;
    const d = t - b.timeMs;
    const entry = { sectorId: sid, timeMs: t, deltaToBestMs: d };
    if (d <= 50) strong.push(entry);
    else {
      weak.push(entry);
      loss.push({ where: `${sid} vs your best ${sid} (lap ${b.lapNumber})`, approxMs: d, basis: "calculated" });
    }
  }

  const comparison = best && best.id !== lap.id ? compareLaps(best, lap, corners) : null;
  if (comparison) {
    for (const s of comparison.biggestLossesForB) {
      loss.push({ where: `${s.fromPct}–${s.toPct}% of lap distance vs best lap`, approxMs: s.deltaMs, basis: "estimated" });
    }
  }
  loss.sort((a, b) => b.approxMs - a.approxMs);

  return {
    lap: { id: lap.id, lapNumber: lap.lapNumber, isTimed: lap.isTimed },
    lapTime: m.lapTimeMs / 1000,
    lapTimeFormatted: formatLapTime(m.lapTimeMs),
    bestLapDifference: summary.bestLap && lap.isTimed ? (m.lapTimeMs - summary.bestLap.lapTimeMs) / 1000 : null,
    theoreticalBestDifference: summary.theoreticalBestMs != null && lap.isTimed ? (m.lapTimeMs - summary.theoreticalBestMs) / 1000 : null,
    strongSectors: strong,
    weakSectors: weak.sort((a, b) => b.deltaToBestMs - a.deltaToBestMs),
    potentialTimeLoss: loss,
    comparisonToBest: comparison,
    corners: corners.map((c) => analyzeCorner(lap.points, c)),
    speed: { maxKmh: m.maxSpeedKmh, averageKmh: m.averageSpeedKmh },
    sessionContext: {
      timedLaps: summary.timedLaps,
      bestLapMs: summary.bestLap?.lapTimeMs ?? null,
      averageLapMs: summary.averageLapTimeMs,
      consistencyStdDevMs: summary.consistencyStdDevMs,
    },
    dataQuality: m.gpsQuality.rating,
    dataQualityDetail: m.gpsQuality,
    provenance: {
      lapTime: "calculated",
      sectorTimes: "calculated",
      maxSpeed: "measured",
      averageSpeed: "calculated",
      distance: "calculated",
      "comparisonToBest.segments": "calculated",
      "corners.*.minimumSpeedKmh": "measured",
      "corners.*.brakingZone": "estimated",
      "corners.*.accelerationPoint": "estimated",
      potentialTimeLoss: "estimated",
    },
    caveats,
  };
}
