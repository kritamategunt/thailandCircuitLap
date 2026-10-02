import { describe, expect, it } from "vitest";
import { LiveLapTimer, processSession } from "@/lib/telemetry";
import { LAP_MS, circleTrack, genCircle } from "./helpers";

describe("LiveLapTimer", () => {
  it("matches server-side lap times", () => {
    const pts = genCircle({ durationMs: LAP_MS * 3.3, interval: (i) => [800, 1200, 1000][i % 3]! });
    const timer = new LiveLapTimer(circleTrack);
    for (const p of pts) timer.feed(p);
    const live = timer.getState();
    const server = processSession(pts, circleTrack).laps.filter((l) => l.isTimed).map((l) => l.metrics.lapTimeMs);
    expect(live.completedLaps.map((l) => l.lapTimeMs)).toEqual(server);
    expect(live.bestLapMs).toBe(Math.min(...server));
    expect(live.lapNumber).toBe(5); // out + 3 timed + current in-lap
  });

  it("ignores duplicates and out-of-order fixes", () => {
    const pts = genCircle({ durationMs: 5_000 });
    const timer = new LiveLapTimer(circleTrack);
    timer.feed(pts[2]!);
    timer.feed(pts[1]!);
    timer.feed(pts[2]!);
    expect(timer.getState().pointCount).toBe(1);
  });

  it("derives speed when device speed is null", () => {
    const pts = genCircle({ durationMs: 5_000, speed: false });
    const timer = new LiveLapTimer(circleTrack);
    for (const p of pts) timer.feed(p);
    expect(timer.getState().speedKmh!).toBeGreaterThan(135);
  });
});
