import type { CleanPoint, GeoLine, LineCrossing } from "@/lib/types";
import { makeProjector, type XY } from "./distance";

export type ProjectedLine = {
  a: XY;
  b: XY;
  project: (c: { latitude: number; longitude: number }) => XY;
  lengthMeters: number;
};

/** Project a timing line into local meters and extend each end by toleranceMeters. */
export function projectLine(line: GeoLine, toleranceMeters = 0): ProjectedLine | null {
  const origin = {
    latitude: (line.pointA.latitude + line.pointB.latitude) / 2,
    longitude: (line.pointA.longitude + line.pointB.longitude) / 2,
  };
  const project = makeProjector(origin);
  const a0 = project(line.pointA);
  const b0 = project(line.pointB);
  const len = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  if (len < 0.5) return null; // degenerate / placeholder line
  const ux = (b0.x - a0.x) / len;
  const uy = (b0.y - a0.y) / len;
  return {
    a: { x: a0.x - ux * toleranceMeters, y: a0.y - uy * toleranceMeters },
    b: { x: b0.x + ux * toleranceMeters, y: b0.y + uy * toleranceMeters },
    project,
    lengthMeters: len + 2 * toleranceMeters,
  };
}

const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export type SegmentCrossing = {
  /** 0..1 position along the movement segment P->Q. */
  t: number;
  direction: "left-to-right" | "right-to-left";
};

/**
 * Does movement segment P->Q cross timing line A->B?
 * Pure 2D segment intersection. Touching the line exactly at P is NOT a crossing
 * (prevents double counting when a fix lands precisely on the line).
 */
export function segmentCrossesLine(p: XY, q: XY, a: XY, b: XY): SegmentCrossing | null {
  const sideP = cross(a, b, p); // >0 left of A->B, <0 right
  const sideQ = cross(a, b, q);
  // Q exactly on the line counts here (t=1); the next segment then starts on the line (sideP=0) and is skipped.
  if (sideP === 0 || sideP * sideQ > 0) return null;
  const d1 = cross(p, q, a);
  const d2 = cross(p, q, b);
  if (d1 * d2 > 0) return null; // crosses the infinite line outside A..B
  const t = sideP / (sideP - sideQ);
  return { t, direction: sideP > 0 ? "left-to-right" : "right-to-left" };
}

/** Convenience API (lat/lng) for tests and one-off checks. */
export function hasCrossedLine(
  prev: { latitude: number; longitude: number },
  curr: { latitude: number; longitude: number },
  line: GeoLine,
  toleranceMeters = 0,
): SegmentCrossing | null {
  const pl = projectLine(line, toleranceMeters);
  if (!pl) return null;
  return segmentCrossesLine(pl.project(prev), pl.project(curr), pl.a, pl.b);
}

/**
 * All crossings of `line` along a clean trajectory.
 * Segments flagged breakBefore (gap / GPS jump) are never used.
 * Crossing time and speed are linearly interpolated between the two fixes.
 */
export function findLineCrossings(
  points: CleanPoint[],
  line: GeoLine,
  toleranceMeters = 0,
): LineCrossing[] {
  const pl = projectLine(line, toleranceMeters);
  if (!pl) return [];
  const out: LineCrossing[] = [];
  let prevXY: XY | null = null;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const xy = pl.project(pt);
    if (prevXY && !pt.breakBefore) {
      const prev = points[i - 1]!;
      const hit = segmentCrossesLine(prevXY, xy, pl.a, pl.b);
      if (hit) {
        const ts = prev.timestamp + hit.t * (pt.timestamp - prev.timestamp);
        const speedMs =
          prev.speed != null && pt.speed != null ? prev.speed + hit.t * (pt.speed - prev.speed) : pt.speed ?? prev.speed ?? null;
        out.push({ timestamp: ts, pointIndex: i, direction: hit.direction, speedMs });
      }
    }
    prevXY = xy;
  }
  return out;
}
