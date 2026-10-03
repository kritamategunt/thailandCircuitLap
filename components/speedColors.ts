/** Speed colour scale shared by the map and the speed chart: red = slow, yellow = mid, green = fast. */
export const SPEED_COLORS = ["#ff2d2d", "#ffd500", "#19e27a"] as const;

export type SpeedRange = { lo: number; hi: number };

/**
 * km/h range to colour over, taken from the data itself (5th–95th percentile, so GPS spikes don't
 * flatten the scale), rounded to 10 km/h so a growing live trail doesn't make colours flicker.
 */
export function speedRange(values: Array<number | null | undefined>): SpeedRange | null {
  const v = values.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const pick = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]!;
  const lo = Math.floor(pick(0.05) / 10) * 10;
  const hi = Math.max(lo + 20, Math.ceil(pick(0.95) / 10) * 10);
  return { lo, hi };
}

/** MapLibre `interpolate` stops for a range. */
export function speedStops({ lo, hi }: SpeedRange): Array<number | string> {
  return [lo, SPEED_COLORS[0], (lo + hi) / 2, SPEED_COLORS[1], hi, SPEED_COLORS[2]];
}
