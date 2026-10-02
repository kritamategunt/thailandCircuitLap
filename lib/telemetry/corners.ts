import type { CleanPoint, CornerDefinition } from "@/lib/types";
import { calculateDistance } from "./distance";
import { buildSpeedSeries, medianFilter3, speedAtDistance, type SpeedSample } from "./speed";

export type Confidence = "low" | "medium" | "high";

/** A value that is an ESTIMATE, always reported as a range with a confidence. */
export type EstimatedRange = {
  kind: "estimated";
  /** Meters before (+) / after (-) the apex. */
  minMetersBeforeApex: number;
  maxMetersBeforeApex: number;
  confidence: Confidence;
  method: string;
};

export type CornerData = {
  cornerId: string;
  cornerName: string;
  found: boolean;
  reason?: string;
  /** measured = device Doppler speed at/near a fix; calculated = interpolated/derived. */
  entrySpeedKmh: { value: number | null; kind: "measured" | "calculated" };
  minimumSpeedKmh: { value: number | null; kind: "measured" | "calculated"; approxMetersFromApex: number | null };
  exitSpeedKmh: { value: number | null; kind: "measured" | "calculated" };
  timeThroughCornerMs: { value: number | null; kind: "calculated" };
  brakingZone: EstimatedRange | null;
  accelerationPoint: EstimatedRange | null;
  dataQuality: {
    samplesInWindow: number;
    meanSampleSpacingMeters: number | null;
    meanAccuracyMeters: number | null;
    apexMatchDistanceMeters: number | null;
    confidence: Confidence;
  };
  note: string;
};

const MAX_APEX_MATCH_M = 40;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Corner analysis from GPS only. Braking / acceleration points are ESTIMATES derived from the
 * speed trace (where speed peaks before the corner, where it bottoms out), reported as ranges
 * whose width = sample spacing + mean GPS accuracy. Never presented as exact.
 */
export function analyzeCorner(lapPoints: CleanPoint[], corner: CornerDefinition): CornerData {
  const entryW = corner.entryWindowMeters ?? 150;
  const exitW = corner.exitWindowMeters ?? 120;
  const base: CornerData = {
    cornerId: corner.id,
    cornerName: corner.name,
    found: false,
    entrySpeedKmh: { value: null, kind: "calculated" },
    minimumSpeedKmh: { value: null, kind: "calculated", approxMetersFromApex: null },
    exitSpeedKmh: { value: null, kind: "calculated" },
    timeThroughCornerMs: { value: null, kind: "calculated" },
    brakingZone: null,
    accelerationPoint: null,
    dataQuality: { samplesInWindow: 0, meanSampleSpacingMeters: null, meanAccuracyMeters: null, apexMatchDistanceMeters: null, confidence: "low" },
    note: "",
  };
  const series = buildSpeedSeries(lapPoints);
  if (series.length < 3) return { ...base, reason: "Not enough GPS points in this lap." };

  // Nearest point to apex (projected onto the trajectory).
  let apexIdx = -1;
  let apexDist = Infinity;
  series.forEach((s, i) => {
    const d = calculateDistance(s, corner.apex);
    if (d < apexDist) {
      apexDist = d;
      apexIdx = i;
    }
  });
  if (apexIdx < 0 || apexDist > MAX_APEX_MATCH_M) {
    return { ...base, reason: `Trajectory never came within ${MAX_APEX_MATCH_M} m of the configured apex (closest ${Math.round(apexDist)} m). Check track calibration.` };
  }

  const apexS = series[apexIdx]!.distance;
  const from = apexS - entryW;
  const to = apexS + exitW;
  const win = series.filter((s) => s.distance >= from && s.distance <= to);
  if (win.length < 3) return { ...base, reason: "Too few GPS samples around this corner." };

  const smooth = medianFilter3(win.map((s) => s.speedKmh));
  let minI = -1;
  smooth.forEach((v, i) => {
    if (v != null && (minI < 0 || v < smooth[minI]!)) minI = i;
  });
  let peakI = -1;
  for (let i = 0; i < minI; i++) if (smooth[i] != null && (peakI < 0 || smooth[i]! > smooth[peakI]!)) peakI = i;

  const spacing = win.length > 1 ? (win[win.length - 1]!.distance - win[0]!.distance) / (win.length - 1) : null;
  const meanAcc = win.reduce((a, s) => a + (Number.isFinite(s.accuracy) ? s.accuracy : 0), 0) / win.length;
  const confidence: Confidence = spacing != null && spacing <= 5 && meanAcc <= 5 ? "high" : spacing != null && spacing <= 15 && meanAcc <= 10 ? "medium" : "low";
  const halfWidth = (spacing ?? 20) + meanAcc;

  const range = (s: SpeedSample, method: string): EstimatedRange => {
    const c = apexS - s.distance;
    return {
      kind: "estimated",
      minMetersBeforeApex: roundTo(c - halfWidth, 5),
      maxMetersBeforeApex: roundTo(c + halfWidth, 5),
      confidence: confidence === "high" ? "medium" : "low", // inferred from speed only, no brake/throttle channel
      method,
    };
  };

  const entry = speedAtDistance(series, Math.max(from, 0));
  const exit = speedAtDistance(series, Math.min(to, series[series.length - 1]!.distance));
  const tAt = (d: number) => timeAtDistance(series, d);
  const t0 = tAt(Math.max(from, 0));
  const t1 = tAt(Math.min(to, series[series.length - 1]!.distance));
  const minSample = minI >= 0 ? win[minI]! : null;

  return {
    ...base,
    found: true,
    entrySpeedKmh: { value: entry == null ? null : Math.round(entry), kind: "calculated" },
    minimumSpeedKmh: {
      value: minI >= 0 && smooth[minI] != null ? Math.round(smooth[minI]!) : null,
      kind: minSample?.measured ? "measured" : "calculated",
      approxMetersFromApex: minSample ? roundTo(minSample.distance - apexS, 5) : null,
    },
    exitSpeedKmh: { value: exit == null ? null : Math.round(exit), kind: "calculated" },
    timeThroughCornerMs: { value: t0 != null && t1 != null ? Math.round(t1 - t0) : null, kind: "calculated" },
    brakingZone: peakI >= 0 && peakI < minI ? range(win[peakI]!, "Location of peak speed before the corner minimum (speed starts dropping). No brake sensor.") : null,
    accelerationPoint: minSample ? range(minSample, "Location where speed stops falling and begins to rise. No throttle sensor.") : null,
    dataQuality: {
      samplesInWindow: win.length,
      meanSampleSpacingMeters: spacing == null ? null : Math.round(spacing),
      meanAccuracyMeters: Math.round(meanAcc),
      apexMatchDistanceMeters: Math.round(apexDist),
      confidence,
    },
    note: "Phone GPS only. Speeds are rounded; braking/acceleration are estimated zones, not measured points.",
  };
}

function timeAtDistance(series: SpeedSample[], d: number): number | null {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (d >= a.distance && d <= b.distance) {
      const span = b.distance - a.distance;
      const t = span > 0 ? (d - a.distance) / span : 0;
      return a.timestamp + t * (b.timestamp - a.timestamp);
    }
  }
  return null;
}

export { timeAtDistance };
