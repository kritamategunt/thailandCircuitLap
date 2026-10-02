import { describe, expect, it } from "vitest";
import { bearingDeg, calculateDistance, detectLaps, offset, startLineAt, travelHeading, withStartFinish } from "@/lib/telemetry";
import { freeRoad } from "@/tracks";
import type { CleanPoint } from "@/lib/types";

const origin = { latitude: 13.75, longitude: 100.5 };

describe("free road start line", () => {
  it("offset/bearing round-trip", () => {
    const east = offset(origin, 90, 100);
    expect(calculateDistance(origin, east)).toBeCloseTo(100, 0);
    expect(bearingDeg(origin, east)).toBeCloseTo(90, 0);
  });

  it("line is perpendicular to heading and 30 m wide", () => {
    const l = startLineAt(origin, 0);
    expect(calculateDistance(l.pointA, l.pointB)).toBeCloseTo(30, 0);
    expect(bearingDeg(l.pointA, l.pointB)).toBeCloseTo(90, 0);
  });

  it("heading falls back to bearing from history when device heading is missing", () => {
    const prev = offset(origin, 180, 20); // came from the south
    expect(travelHeading({ ...origin, heading: null, speed: null }, [prev])).toBeCloseTo(0, 0);
    expect(travelHeading({ ...origin, heading: null, speed: null }, [offset(origin, 180, 2)])).toBeNull();
  });

  it("times laps on a loop once the line is set", () => {
    // 1 km square loop at ~36 km/h (10 m/s), 1 Hz, 3 laps.
    const pts: CleanPoint[] = [];
    let t = Date.UTC(2026, 0, 1);
    const corners = [0, 90, 180, 270];
    let pos = offset(origin, 180, 50);
    for (let lap = 0; lap < 3; lap++)
      for (const h of corners)
        for (let i = 0; i < 25; i++) {
          pts.push({ ...pos, timestamp: t, speed: 10, accuracy: 5, heading: h, lowQuality: false, breakBefore: false });
          pos = offset(pos, h, 10);
          t += 1000;
        }
    const track = withStartFinish(freeRoad, startLineAt(origin, 0));
    const { laps } = detectLaps(pts, track);
    const timed = laps.filter((l) => l.isTimed);
    expect(timed.length).toBe(2);
    for (const l of timed) expect(l.endTime - l.startTime).toBeCloseTo(100_000, -3);
  });

  it("leaves real circuits untouched", () => {
    expect(withStartFinish({ ...freeRoad, free: false }, startLineAt(origin, 0)).verified).toBe(false);
  });
});
