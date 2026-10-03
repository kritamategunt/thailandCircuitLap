import type { Coordinate, GPSPoint } from "@/lib/types";
import { calculateDistance } from "./distance";
import { bearingDeg, travelHeading } from "./freeRoad";

/** A position this close to a trail counts as "on" it (2 × phone GPS error + road width). */
export const GAP_SNAP_M = 40;
/** A rider who stays within this radius is not moving (absorbs GPS wander while parked). */
const STOP_RADIUS_M = 15;

export type RiderGap = {
  /** Always ≥ 0; `position` says which way. */
  meters: number;
  /** "away" = straight-line distance, direction unknown (no shared road yet, or I'm not moving). */
  position: "ahead" | "behind" | "away";
  /** Time gap in seconds (when I'll be where they are / when they'll be where I am). Null for straight-line gaps. */
  seconds: number | null;
  /** True when measured along the road one rider just rode (more meaningful than straight-line). */
  alongRoute: boolean;
};

/**
 * Where is `friend` relative to me? If the friend is on my recent trail they're behind me, by the
 * distance I've ridden since that spot; if I'm on theirs they're ahead. Otherwise straight-line
 * distance, ahead/behind judged from my travel heading. Trails must be time-ordered.
 */
export function gapTo(me: GPSPoint[], friend: GPSPoint[]): RiderGap | null {
  const m = me[me.length - 1];
  const f = friend[friend.length - 1];
  if (!m || !f) return null;

  const behind = locateOnTrail(me, f); // friend is where I was
  const ahead = locateOnTrail(friend, m); // I'm where the friend was
  if (behind && (!ahead || behind.meters <= ahead.meters))
    return { meters: behind.meters, position: "behind", seconds: Math.max(0, (f.timestamp - me[behind.index]!.timestamp) / 1000), alongRoute: true };
  if (ahead) return { meters: ahead.meters, position: "ahead", seconds: Math.max(0, (m.timestamp - friend[ahead.index]!.timestamp) / 1000), alongRoute: true };

  const meters = calculateDistance(m, f);
  const heading = travelHeading(m, me.slice(-30, -1));
  if (heading == null) return { meters, position: "away", seconds: null, alongRoute: false };
  const diff = Math.abs(((bearingDeg(m, f) - heading + 540) % 360) - 180);
  return { meters, position: diff < 90 ? "ahead" : "behind", seconds: null, alongRoute: false };
}

/** Nearest trail point to `p` (within GAP_SNAP_M) and the distance ridden from there to the trail's end. */
function locateOnTrail(trail: GPSPoint[], p: Coordinate): { index: number; meters: number } | null {
  // Flat-earth squared distance: runs every GPS fix for every friend, haversine is overkill at 40 m.
  const kx = 111_320 * Math.cos((p.latitude * Math.PI) / 180);
  let index = -1;
  let best = GAP_SNAP_M * GAP_SNAP_M;
  for (let i = 0; i < trail.length; i++) {
    const dx = (trail[i]!.longitude - p.longitude) * kx;
    const dy = (trail[i]!.latitude - p.latitude) * 111_320;
    const d = dx * dx + dy * dy;
    if (d <= best) {
      best = d;
      index = i;
    }
  }
  if (index < 0) return null;
  let meters = 0;
  for (let i = index + 1; i < trail.length; i++) meters += calculateDistance(trail[i - 1]!, trail[i]!);
  return { index, meters };
}

/**
 * How long the rider has been stationary at their latest position (ms), from positions only so it
 * works when the phone reports no speed. 0 while moving, or when they never moved in this trail.
 */
export function stoppedForMs(trail: GPSPoint[]): number {
  const last = trail[trail.length - 1];
  if (!last) return 0;
  let k = trail.length - 1;
  while (k > 0 && calculateDistance(trail[k - 1]!, last) <= STOP_RADIUS_M) k--;
  if (k === 0) return 0; // never left this spot in the window we have: parked before the ride, not "stopped"
  return last.timestamp - trail[k]!.timestamp;
}
