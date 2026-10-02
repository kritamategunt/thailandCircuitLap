import type { GPSPoint, TrackDefinition } from "@/lib/types";

export const CENTER = { latitude: 13.9, longitude: 100.17 };
export const R = 400; // meters
const M_PER_DEG_LAT = 111_195;
const mPerDegLon = M_PER_DEG_LAT * Math.cos((CENTER.latitude * Math.PI) / 180);

export function polar(angleRad: number, r = R) {
  return {
    latitude: CENTER.latitude + (r * Math.sin(angleRad)) / M_PER_DEG_LAT,
    longitude: CENTER.longitude + (r * Math.cos(angleRad)) / mPerDegLon,
  };
}

/** Radial timing line at angle (from r-10 to r+10: A inner, B outer). */
export function radialLine(angleRad: number) {
  return { pointA: polar(angleRad, R - 10), pointB: polar(angleRad, R + 10) };
}

export const circleTrack: TrackDefinition = {
  id: "test-circle",
  name: "Test Circle",
  country: "TH",
  center: CENTER,
  defaultZoom: 16,
  startFinishLine: radialLine(0),
  // CCW motion at angle 0 is northward = crossing A->B(east) from right to left.
  direction: "right-to-left",
  lineToleranceMeters: 2,
  sectors: [
    { id: "S1", name: "S1", endLine: radialLine((2 * Math.PI) / 3) },
    { id: "S2", name: "S2", endLine: radialLine((4 * Math.PI) / 3) },
    { id: "S3", name: "S3" },
  ],
  corners: [{ id: "T1", name: "Turn 1", apex: polar(Math.PI / 2) }],
  verified: true,
};

export const SPEED_MS = 40; // 144 km/h
export const LAP_MS = ((2 * Math.PI * R) / SPEED_MS) * 1000; // ≈ 62 832 ms

export type GenOpts = {
  startAngle?: number;
  durationMs: number;
  t0?: number;
  /** returns next interval in ms */
  interval?: (i: number) => number;
  speed?: boolean;
  accuracy?: number;
  altitude?: boolean;
  speedMs?: (t: number, angleRad: number) => number;
};

/** Constant-speed CCW circle (or variable speed via speedMs). */
export function genCircle(o: GenOpts): GPSPoint[] {
  const t0 = o.t0 ?? 1_700_000_000_000;
  const pts: GPSPoint[] = [];
  let t = 0;
  let angle = o.startAngle ?? -0.5;
  let i = 0;
  while (t <= o.durationMs) {
    const v = o.speedMs ? o.speedMs(t, angle) : SPEED_MS;
    const pos = polar(angle);
    pts.push({
      timestamp: t0 + Math.round(t),
      ...pos,
      speed: o.speed === false ? null : v,
      accuracy: o.accuracy ?? 4,
      ...(o.altitude ? { altitude: 5 } : {}),
    });
    const dt = o.interval ? o.interval(i) : 1000;
    // integrate angle with the speed at this step
    angle += (v * (dt / 1000)) / R;
    t += dt;
    i++;
  }
  return pts;
}
