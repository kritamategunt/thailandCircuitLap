import { describe, expect, it } from "vitest";
import { gapTo, offset, rideAlerts, stoppedForMs, type FriendState } from "@/lib/telemetry";
import type { GPSPoint } from "@/lib/types";

const origin = { latitude: 13.75, longitude: 100.5 };
const T0 = Date.UTC(2026, 0, 1);

/** Riding north at 10 m/s, 1 Hz, from `startM` metres north of origin, starting at `t0`. */
function ride(startM: number, seconds: number, t0 = T0): GPSPoint[] {
  return Array.from({ length: seconds + 1 }, (_, i) => ({ ...offset(origin, 0, startM + i * 10), timestamp: t0 + i * 1000, speed: 10, accuracy: 5 }));
}

describe("gapTo", () => {
  it("friend on my trail is behind, by distance and time", () => {
    const me = ride(0, 60); // ends 600 m north at T0+60s
    const friend = ride(0, 30, T0 + 30_000); // same road, started 30 s later: ends 300 m north at T0+60s
    const g = gapTo(me, friend)!;
    expect(g.position).toBe("behind");
    expect(g.alongRoute).toBe(true);
    expect(g.meters).toBeCloseTo(300, -1);
    expect(g.seconds).toBeCloseTo(30, 0);
  });

  it("me on friend's trail means they're ahead", () => {
    const me = ride(0, 30, T0 + 30_000);
    const friend = ride(0, 60);
    const g = gapTo(me, friend)!;
    expect(g.position).toBe("ahead");
    expect(g.meters).toBeCloseTo(300, -1);
    expect(g.seconds).toBeCloseTo(30, 0);
  });

  it("no shared road: straight line, ahead/behind from my heading", () => {
    const me = ride(0, 10);
    const north = [{ ...offset(origin, 0, 5000), timestamp: T0 + 10_000, speed: 0, accuracy: 5 }];
    const south = [{ ...offset(origin, 180, 5000), timestamp: T0 + 10_000, speed: 0, accuracy: 5 }];
    expect(gapTo(me, north)).toMatchObject({ position: "ahead", alongRoute: false, seconds: null });
    expect(gapTo(me, south)?.position).toBe("behind");
  });
});

describe("stoppedForMs", () => {
  it("counts time parked after moving, ignores never-moved riders", () => {
    const moving = ride(0, 20);
    const last = moving[moving.length - 1]!;
    const parked = Array.from({ length: 90 }, (_, i) => ({ ...offset(last, 90, (i % 3) * 2), timestamp: last.timestamp + (i + 1) * 1000, speed: 0, accuracy: 5 }));
    expect(stoppedForMs([...moving, ...parked])).toBeGreaterThanOrEqual(89_000);
    expect(stoppedForMs(moving)).toBeLessThan(5_000); // consecutive 1 Hz fixes can sit inside the parked radius
    expect(stoppedForMs(parked)).toBe(0);
  });
});

describe("rideAlerts", () => {
  const friend = (over: Partial<FriendState>): FriendState => ({ id: "a", name: "Ann", gap: null, stoppedMs: 0, signalAgeMs: 1000, finished: false, ...over });

  it("speed only above the chosen limit, and never when the limit is off", () => {
    expect(rideAlerts({ mySpeedKmh: 110, speedLimitKmh: 100, friends: [] }).map((a) => a.key)).toEqual(["speed"]);
    expect(rideAlerts({ mySpeedKmh: 95, speedLimitKmh: 100, friends: [] })).toEqual([]);
    expect(rideAlerts({ mySpeedKmh: 200, speedLimitKmh: null, friends: [] })).toEqual([]);
  });

  it("friend far behind, stopped, or silent", () => {
    const keys = (f: FriendState) => rideAlerts({ mySpeedKmh: 50, speedLimitKmh: null, friends: [f] }).map((a) => a.key);
    expect(keys(friend({ gap: { meters: 1200, position: "behind", seconds: 50, alongRoute: true } }))).toEqual(["behind:a"]);
    expect(keys(friend({ gap: { meters: 300, position: "behind", seconds: 75, alongRoute: true } }))).toEqual(["behind:a"]);
    expect(keys(friend({ gap: { meters: 300, position: "behind", seconds: 20, alongRoute: true } }))).toEqual([]);
    expect(keys(friend({ gap: { meters: 1500, position: "ahead", seconds: 80, alongRoute: true } }))).toEqual([]);
    expect(keys(friend({ stoppedMs: 70_000 }))).toEqual(["stopped:a"]);
    expect(keys(friend({ signalAgeMs: 130_000, stoppedMs: 70_000 }))).toEqual(["signal:a"]);
    expect(keys(friend({ signalAgeMs: 130_000, finished: true }))).toEqual([]);
  });
});
