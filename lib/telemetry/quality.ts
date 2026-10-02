import type { CleanPoint, GPSPoint } from "@/lib/types";
import { calculateDistance, isValidCoordinate } from "./distance";
import { withDefaults, type TelemetryOptions } from "./config";

export type SanitizeResult = {
  points: CleanPoint[];
  droppedInvalid: number;
  droppedDuplicates: number;
  droppedJumps: number;
};

/** How many consecutive "jump" points we reject before accepting that the position really moved. */
const MAX_CONSECUTIVE_JUMP_REJECTS = 3;

/**
 * Turn raw device fixes into a clean, time-ordered trajectory.
 *  - invalid coordinates / timestamps: dropped
 *  - out-of-order timestamps: sorted
 *  - duplicate timestamps: keep the more accurate fix
 *  - poor accuracy: KEPT, flagged lowQuality
 *  - GPS jump (implied speed > plausible): outlier dropped; if it persists, accepted with a break
 *  - long time gap (signal loss / pause): kept, flagged breakBefore
 */
export function sanitizePoints(raw: GPSPoint[], opts?: Partial<TelemetryOptions>): SanitizeResult {
  const o = withDefaults(opts);
  let droppedInvalid = 0;
  let droppedDuplicates = 0;
  let droppedJumps = 0;

  const valid = raw.filter((p) => {
    const ok = Number.isFinite(p.timestamp) && isValidCoordinate(p);
    if (!ok) droppedInvalid++;
    return ok;
  });
  valid.sort((a, b) => a.timestamp - b.timestamp);

  const deduped: GPSPoint[] = [];
  for (const p of valid) {
    const last = deduped[deduped.length - 1];
    if (last && last.timestamp === p.timestamp) {
      droppedDuplicates++;
      if (acc(p) < acc(last)) deduped[deduped.length - 1] = p;
      continue;
    }
    deduped.push(p);
  }

  const out: CleanPoint[] = [];
  let rejectStreak = 0;
  for (const p of deduped) {
    const lowQuality = !(Number.isFinite(p.accuracy) && p.accuracy <= o.maxAccuracyMeters);
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...p, lowQuality, breakBefore: false });
      continue;
    }
    const dtMs = p.timestamp - prev.timestamp;
    if (dtMs > o.maxSegmentGapMs) {
      out.push({ ...p, lowQuality, breakBefore: true });
      rejectStreak = 0;
      continue;
    }
    const impliedKmh = (calculateDistance(prev, p) / (dtMs / 1000)) * 3.6;
    if (impliedKmh > o.maxPlausibleSpeedKmh) {
      if (rejectStreak < MAX_CONSECUTIVE_JUMP_REJECTS) {
        rejectStreak++;
        droppedJumps++;
        continue;
      }
      // Position genuinely changed (e.g. reacquired lock): accept but never time across it.
      out.push({ ...p, lowQuality, breakBefore: true });
      rejectStreak = 0;
      continue;
    }
    rejectStreak = 0;
    out.push({ ...p, lowQuality, breakBefore: false });
  }

  return { points: out, droppedInvalid, droppedDuplicates, droppedJumps };
}

function acc(p: GPSPoint): number {
  return Number.isFinite(p.accuracy) ? p.accuracy : Number.POSITIVE_INFINITY;
}

/** Live-UI helper: classify a single fix for the GPS status badge. */
export function classifyAccuracy(accuracy: number | null | undefined): "good" | "fair" | "poor" | "none" {
  if (accuracy == null || !Number.isFinite(accuracy)) return "none";
  if (accuracy <= 8) return "good";
  if (accuracy <= 20) return "fair";
  return "poor";
}
