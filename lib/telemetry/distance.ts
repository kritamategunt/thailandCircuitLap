import type { Coordinate } from "@/lib/types";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function calculateDistance(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Sum of segment distances along a path. */
export function pathDistance(points: Coordinate[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += calculateDistance(points[i - 1]!, points[i]!);
  return d;
}

export type XY = { x: number; y: number };

/**
 * Local planar projection (equirectangular) around an origin, in meters.
 * Accurate to well under 1 cm over a few km — far beyond phone GPS precision.
 */
export function makeProjector(origin: Coordinate) {
  const cosLat = Math.cos(toRad(origin.latitude));
  const k = (Math.PI / 180) * EARTH_RADIUS_M;
  return (c: Coordinate): XY => ({
    x: (c.longitude - origin.longitude) * k * cosLat,
    y: (c.latitude - origin.latitude) * k,
  });
}

export function isValidCoordinate(c: Coordinate): boolean {
  return (
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    c.latitude >= -90 &&
    c.latitude <= 90 &&
    c.longitude >= -180 &&
    c.longitude <= 180
  );
}
