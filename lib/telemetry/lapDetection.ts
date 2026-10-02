import type { CleanPoint, DetectedLap, LineCrossing, TrackDefinition } from "@/lib/types";
import { findLineCrossings } from "./lineCrossing";
import { withDefaults, type TelemetryOptions } from "./config";

/**
 * Filter raw start/finish crossings into valid lap boundaries.
 *  - wrong direction (when the track defines one): ignored
 *  - within cooldown of the last accepted crossing: ignored (jitter, duplicate crossing)
 *  - would create a lap shorter than MIN_LAP_TIME: ignored (rider looping near the line)
 */
export function filterCrossings(
  crossings: LineCrossing[],
  direction: TrackDefinition["direction"],
  opts?: Partial<TelemetryOptions>,
): LineCrossing[] {
  const o = withDefaults(opts);
  const minGapMs = Math.max(o.minLapTimeSeconds, o.crossingCooldownSeconds) * 1000;
  const accepted: LineCrossing[] = [];
  for (const c of crossings) {
    if (direction !== "any" && c.direction !== direction) continue;
    const last = accepted[accepted.length - 1];
    if (last && c.timestamp - last.timestamp < minGapMs) continue;
    accepted.push(c);
  }
  return accepted;
}

export type LapDetectionResult = {
  crossings: LineCrossing[];
  laps: DetectedLap[];
};

/**
 * Split a session trajectory into laps.
 *   Session start -> first crossing      = Lap 1 ("out", not timed)
 *   crossing N    -> crossing N+1        = timed lap
 *   last crossing -> last point          = "in" lap (incomplete, not timed)
 */
export function detectLaps(
  points: CleanPoint[],
  track: TrackDefinition,
  opts?: Partial<TelemetryOptions>,
): LapDetectionResult {
  if (points.length === 0) return { crossings: [], laps: [] };
  const raw = findLineCrossings(points, track.startFinishLine, track.lineToleranceMeters);
  const crossings = filterCrossings(raw, track.direction, opts);
  const first = points[0]!.timestamp;
  const last = points[points.length - 1]!.timestamp;

  const laps: DetectedLap[] = [];
  let lapNumber = 1;
  let cursor = first;
  for (const c of crossings) {
    const isOutLap = laps.length === 0;
    laps.push({
      lapNumber: lapNumber++,
      kind: isOutLap ? "out" : "timed",
      startTime: cursor,
      endTime: c.timestamp,
      isTimed: !isOutLap,
    });
    cursor = c.timestamp;
  }
  if (last > cursor) {
    laps.push({ lapNumber: lapNumber++, kind: "in", startTime: cursor, endTime: last, isTimed: false });
  }
  return { crossings, laps };
}

/**
 * Incremental single-step check used by the live UI: did the newest segment complete a lap?
 * Returns the crossing (time-interpolated) or null.
 */
export function detectLap(
  prev: CleanPoint,
  curr: CleanPoint,
  track: TrackDefinition,
  lastCrossingTime: number | null,
  opts?: Partial<TelemetryOptions>,
): LineCrossing | null {
  if (curr.breakBefore) return null;
  const found = findLineCrossings([{ ...prev, breakBefore: false }, curr], track.startFinishLine, track.lineToleranceMeters);
  const c = found[0];
  if (!c) return null;
  const prevAccepted: LineCrossing[] =
    lastCrossingTime == null ? [] : [{ timestamp: lastCrossingTime, pointIndex: -1, direction: c.direction, speedMs: null }];
  const accepted = filterCrossings([...prevAccepted, c], track.direction, opts);
  return accepted[accepted.length - 1] === c ? c : null;
}
