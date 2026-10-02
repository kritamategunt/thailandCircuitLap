import type { TrackDefinition } from "@/lib/types";

/**
 * Motor Sport Park Suvarnabhumi — Lat Krabang, Bangkok, Thailand (Romklao Rd).
 *
 * SINGLE SOURCE OF TRUTH for this track's geometry. Business logic never hard-codes
 * coordinates; it reads this object.
 *
 * ⚠️  PLACEHOLDER GEOMETRY.
 * Only `center` and length come from public sources. Centre = middle of the circuit as
 * seen on Esri World Imagery, ~650 m east of the venue's Romklao Rd entrance (Longdo Map
 * place A10315149: 13.7730244 N, 100.7467318 E). Length ~650 m (rider review on Pantip). Turn count is not published.
 * The start/finish line, sector lines and corner apexes are NOT surveyed and are
 * deliberately left as placeholders — we do not invent GPS data.
 *
 * How to calibrate (5 minutes):
 *   1. Record one slow lap with the app (any session) — or skip and use satellite imagery.
 *   2. Open /track?calibrate=1&track=msp-suvarnabhumi (optionally &session=<id> to overlay your trajectory).
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
export const mspSuvarnabhumi: TrackDefinition = {
  id: "msp-suvarnabhumi",
  name: "Motor Sport Park Suvarnabhumi",
  country: "TH",
  location: "Lat Krabang",
  center: { latitude: 13.7726900, longitude: 100.7529700 },
  defaultZoom: 17,
  lengthMeters: 650,
  // PLACEHOLDER: zero-length line => no laps are detected until calibrated.
  startFinishLine: {
    pointA: { latitude: 13.7726900, longitude: 100.7529700 },
    pointB: { latitude: 13.7726900, longitude: 100.7529700 },
  },
  direction: "any",
  lineToleranceMeters: 5,
  // S1 ends at S1.endLine, S2 ends at S2.endLine, S3 (last) ends at start/finish.
  sectors: [
    { id: "S1", name: "Sector 1" },
    { id: "S2", name: "Sector 2" },
    { id: "S3", name: "Sector 3" },
  ],
  // Turn count not published. Add apexes after calibration.
  corners: [],
  racingLine: undefined,
  boundary: undefined,
  verified: false,
  notes: "Placeholder geometry. Calibrate via /track?calibrate=1&track=msp-suvarnabhumi before relying on lap times.",
};
