import type { Coordinate, GeoLine, TrackDefinition } from "@/lib/types";
import { calculateDistance } from "./distance";

/** Half-width of a dropped start/finish line. Covers a 2–4 lane road plus GPS lateral error. */
export const FREE_ROAD_LINE_HALF_WIDTH_M = 15;
/** Points closer than this to the anchor give a too-noisy bearing. */
const MIN_BEARING_BASE_M = 8;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Initial bearing a -> b in degrees (0 = north, clockwise). */
export function bearingDeg(a: Coordinate, b: Coordinate): number {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `meters` away from `c` along `bearing` (flat-earth; fine for tens of meters). */
export function offset(c: Coordinate, bearing: number, meters: number): Coordinate {
  const dLat = (meters * Math.cos(toRad(bearing))) / 111_320;
  const dLon = (meters * Math.sin(toRad(bearing))) / (111_320 * Math.cos(toRad(c.latitude)));
  return { latitude: c.latitude + dLat, longitude: c.longitude + dLon };
}

/**
 * Travel heading at `current`: device heading when moving, otherwise the bearing from the
 * most recent earlier fix at least MIN_BEARING_BASE_M away. Null when stationary/unknown.
 */
export function travelHeading(current: Coordinate & { heading?: number | null; speed?: number | null }, history: Coordinate[]): number | null {
  if (current.heading != null && (current.speed ?? 0) > 1) return current.heading;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (calculateDistance(h, current) >= MIN_BEARING_BASE_M) return bearingDeg(h, current);
  }
  return null;
}

/** Timing line through `at`, perpendicular to the travel heading. */
export function startLineAt(at: Coordinate, headingDeg: number, halfWidthM = FREE_ROAD_LINE_HALF_WIDTH_M): GeoLine {
  return { pointA: offset(at, headingDeg - 90, halfWidthM), pointB: offset(at, headingDeg + 90, halfWidthM) };
}

/** A free-road track with this session's start/finish applied (timing-ready). */
export function withStartFinish(track: TrackDefinition, line: GeoLine | null | undefined): TrackDefinition {
  if (!track.free || !line) return track;
  return { ...track, startFinishLine: line, center: midpoint(line), verified: true };
}

function midpoint(l: GeoLine): Coordinate {
  return { latitude: (l.pointA.latitude + l.pointB.latitude) / 2, longitude: (l.pointA.longitude + l.pointB.longitude) / 2 };
}
