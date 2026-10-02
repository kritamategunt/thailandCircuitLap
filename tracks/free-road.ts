import type { TrackDefinition } from "@/lib/types";

/**
 * Free Road — any public road or loop, for GPS testing and informal lap capture.
 *
 * Has no fixed geometry. Each session stores its own start/finish line, dropped by the
 * rider on the live screen ("Set start/finish here"); see lib/telemetry/freeRoad.ts.
 * Until a line is set the session records GPS only.
 */
export const freeRoad: TrackDefinition = {
  id: "free-road",
  name: "Free Road",
  country: "TH",
  location: "Any road",
  // Map fallback only (Bangkok); live maps follow the rider instead.
  center: { latitude: 13.7563, longitude: 100.5018 },
  defaultZoom: 16,
  startFinishLine: {
    pointA: { latitude: 13.7563, longitude: 100.5018 },
    pointB: { latitude: 13.7563, longitude: 100.5018 },
  },
  direction: "any",
  lineToleranceMeters: 5,
  sectors: [{ id: "S1", name: "Lap" }],
  corners: [],
  verified: false,
  free: true,
  notes: "No fixed geometry. Set start/finish from the live screen.",
};
