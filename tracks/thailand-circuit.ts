import type { TrackDefinition } from "@/lib/types";

/**
 * Thailand Circuit — Nakhon Chai Si, Nakhon Pathom, Thailand.
 *
 * SINGLE SOURCE OF TRUTH for this track's geometry. Business logic never hard-codes
 * coordinates; it reads this object.
 *
 * ⚠️  PLACEHOLDER GEOMETRY.
 * Only `center` (Wikipedia: 13.9118444 N, 100.1678694 E), length (2.5 km) and turn count
 * (15) come from a public source. The start/finish line, sector lines and corner apexes are
 * NOT surveyed and are deliberately left as placeholders — we do not invent GPS data.
 *
 * How to calibrate (5 minutes):
 *   1. Record one slow lap with the app (any session) — or skip and use satellite imagery.
 *   2. Open /track?calibrate=1 (optionally &session=<id> to overlay your trajectory).
 *   3. Tap point A and B for start/finish (across the full track width), then each sector
 *      line, then each corner apex. The page generates a TypeScript snippet.
 *   4. Paste the snippet below, set `verified: true`, redeploy.
 *   5. Existing sessions are re-timed automatically: POST /api/sessions/:id/recompute
 *      (or open the session page; the server recomputes when finishing).
 *
 * Line convention: a timing line is the segment pointA -> pointB, drawn ACROSS the track.
 * `direction` says which side-change counts as forward, relative to the vector A->B:
 *   "left-to-right": rider moves from the left of A->B to the right of A->B.
 * If unsure, use "any" (both directions count; cooldown + min lap time still protect you).
 */
export const thailandCircuit: TrackDefinition = {
  id: "thailand-circuit",
  name: "Thailand Circuit",
  country: "TH",
  center: { latitude: 13.9118444, longitude: 100.1678694 },
  defaultZoom: 16.5,
  lengthMeters: 2500,
  // PLACEHOLDER: zero-length line => no laps are detected until calibrated.
  startFinishLine: {
    pointA: { latitude: 13.9118444, longitude: 100.1678694 },
    pointB: { latitude: 13.9118444, longitude: 100.1678694 },
  },
  direction: "any",
  lineToleranceMeters: 5,
  // S1 ends at S1.endLine, S2 ends at S2.endLine, S3 (last) ends at start/finish.
  // A non-last sector without endLine is "not configured" -> its time is null.
  sectors: [
    { id: "S1", name: "Sector 1" /* endLine: { pointA: {...}, pointB: {...} } */ },
    { id: "S2", name: "Sector 2" /* endLine: { pointA: {...}, pointB: {...} } */ },
    { id: "S3", name: "Sector 3" },
  ],
  // 15 turns per public sources. Add apexes after calibration, e.g.:
  // { id: "T1", name: "Turn 1", apex: { latitude: 0, longitude: 0 }, entryWindowMeters: 150, exitWindowMeters: 120 },
  corners: [],
  racingLine: undefined,
  boundary: undefined,
  verified: false,
  notes: "Placeholder geometry. Calibrate via /track?calibrate=1 before relying on lap times.",
};
