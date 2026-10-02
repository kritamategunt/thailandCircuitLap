import type { TrackDefinition } from "@/lib/types";

/**
 * Kaeng Krachan Circuit — Kaeng Krachan, Phetchaburi, Thailand.
 *
 * SINGLE SOURCE OF TRUTH for this track's geometry. Business logic never hard-codes
 * coordinates; it reads this object.
 *
 * ⚠️  PLACEHOLDER GEOMETRY.
 * Only `center` (OpenStreetMap raceway way 469691616, bbox centre; Wikipedia's
 * 12°56′31″N 99°42′25″E sits ~500 m south-east of the asphalt), length (full course 2.912 km) and
 * turn count (25) come from a public source. Medium (2.400 km) and short (1.004 km)
 * layouts also exist; this definition targets the full course.
 * The start/finish line, sector lines and corner apexes are NOT surveyed and are
 * deliberately left as placeholders — we do not invent GPS data.
 *
 * How to calibrate (5 minutes):
 *   1. Record one slow lap with the app (any session) — or skip and use satellite imagery.
 *   2. Open /track?calibrate=1&track=kaeng-krachan (optionally &session=<id> to overlay your trajectory).
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
export const kaengKrachan: TrackDefinition = {
  id: "kaeng-krachan",
  name: "Kaeng Krachan Circuit",
  country: "TH",
  location: "Kaeng Krachan",
  center: { latitude: 12.9465817, longitude: 99.7053623 },
  defaultZoom: 15,
  lengthMeters: 2912,
  // PLACEHOLDER: zero-length line => no laps are detected until calibrated.
  startFinishLine: {
    pointA: { latitude: 12.9465817, longitude: 99.7053623 },
    pointB: { latitude: 12.9465817, longitude: 99.7053623 },
  },
  direction: "any",
  lineToleranceMeters: 5,
  // S1 ends at S1.endLine, S2 ends at S2.endLine, S3 (last) ends at start/finish.
  sectors: [
    { id: "S1", name: "Sector 1" },
    { id: "S2", name: "Sector 2" },
    { id: "S3", name: "Sector 3" },
  ],
  // 25 turns (full course) per Wikipedia. Add apexes after calibration.
  corners: [],
  racingLine: undefined,
  boundary: undefined,
  verified: false,
  notes: "Placeholder geometry. Calibrate via /track?calibrate=1&track=kaeng-krachan before relying on lap times.",
};
