import { describe, expect, it } from "vitest";
import {
  calculateLapMetrics,
  detectLap,
  detectLaps,
  detectSector,
  processSession,
  sanitizePoints,
  sliceTrajectory,
  analyzeCorner,
  compareLaps,
  formatLapTime,
} from "@/lib/telemetry";
import type { GPSPoint } from "@/lib/types";
import { LAP_MS, circleTrack, genCircle, polar } from "./helpers";

const threeLaps = () => genCircle({ durationMs: LAP_MS * 3.3 });

describe("sanitizePoints", () => {
  it("sorts out-of-order timestamps and removes duplicates", () => {
    const pts = genCircle({ durationMs: 10_000 });
    const shuffled = [pts[3]!, pts[0]!, pts[1]!, pts[1]!, pts[2]!, ...pts.slice(4)];
    const r = sanitizePoints(shuffled);
    expect(r.droppedDuplicates).toBe(1);
    expect(r.points.map((p) => p.timestamp)).toEqual(pts.map((p) => p.timestamp));
  });
  it("keeps poor-accuracy points but flags them", () => {
    const pts = genCircle({ durationMs: 5_000, accuracy: 60 });
    const r = sanitizePoints(pts);
    expect(r.points).toHaveLength(pts.length);
    expect(r.points.every((p) => p.lowQuality)).toBe(true);
  });
  it("drops invalid coordinates", () => {
    const pts = genCircle({ durationMs: 3_000 });
    pts.push({ ...pts[0]!, timestamp: pts[0]!.timestamp + 99_999, latitude: 120 });
    expect(sanitizePoints(pts).droppedInvalid).toBe(1);
  });
  it("drops a single GPS jump outlier", () => {
    const pts = genCircle({ durationMs: 10_000 });
    pts[5] = { ...pts[5]!, latitude: pts[5]!.latitude + 0.01 }; // ~1.1 km jump in 1 s
    const r = sanitizePoints(pts);
    expect(r.droppedJumps).toBe(1);
    expect(r.points).toHaveLength(pts.length - 1);
  });
  it("marks long gaps as trajectory breaks", () => {
    const pts = genCircle({ durationMs: 20_000 });
    const gapped = [...pts.slice(0, 5), ...pts.slice(14)];
    const r = sanitizePoints(gapped);
    expect(r.points[5]!.breakBefore).toBe(true);
  });
});

describe("detectLaps", () => {
  it("splits into out-lap, timed laps and in-lap with accurate times", () => {
    const { points } = sanitizePoints(threeLaps());
    const { laps } = detectLaps(points, circleTrack);
    expect(laps[0]!.kind).toBe("out");
    const timed = laps.filter((l) => l.isTimed);
    expect(timed).toHaveLength(3);
    for (const l of timed) expect(Math.abs(l.endTime - l.startTime - LAP_MS)).toBeLessThan(60);
    expect(laps[laps.length - 1]!.kind).toBe("in");
  });

  it("handles irregular GPS intervals", () => {
    const intervals = [700, 1300, 900, 2000, 500, 1100];
    const pts = genCircle({ durationMs: LAP_MS * 2.5, interval: (i) => intervals[i % intervals.length]! });
    const { laps } = detectLaps(sanitizePoints(pts).points, circleTrack);
    const timed = laps.filter((l) => l.isTimed);
    expect(timed.length).toBeGreaterThanOrEqual(1);
    for (const l of timed) expect(Math.abs(l.endTime - l.startTime - LAP_MS)).toBeLessThan(150);
  });

  it("ignores jitter: a duplicate crossing seconds later does not create a lap", () => {
    const pts = genCircle({ durationMs: LAP_MS * 2.2 });
    // find first point just after the line and insert a point back across + forward again
    const idx = pts.findIndex((p, i) => i > 0 && p.latitude > polar(0).latitude && pts[i - 1]!.latitude <= polar(0).latitude);
    const p = pts[idx]!;
    const jitter: GPSPoint[] = [
      { ...polar(-0.005), timestamp: p.timestamp + 300, speed: 40, accuracy: 4 },
      { ...polar(0.006), timestamp: p.timestamp + 600, speed: 40, accuracy: 4 },
    ];
    const withJitter = [...pts, ...jitter];
    const base = detectLaps(sanitizePoints(pts).points, circleTrack).laps.length;
    const jittered = detectLaps(sanitizePoints(withJitter).points, circleTrack).laps.length;
    expect(jittered).toBe(base);
  });

  it("does not count laps when riding backwards with a directional track", () => {
    const pts = genCircle({ durationMs: LAP_MS * 2.2 }).map((p, i, arr) => ({ ...p, timestamp: arr[arr.length - 1 - i]!.timestamp }));
    const { laps } = detectLaps(sanitizePoints(pts).points, circleTrack);
    expect(laps.filter((l) => l.isTimed)).toHaveLength(0);
  });

  it("counts backwards laps when direction is 'any'", () => {
    const pts = genCircle({ durationMs: LAP_MS * 2.2 }).map((p, i, arr) => ({ ...p, timestamp: arr[arr.length - 1 - i]!.timestamp }));
    const { laps } = detectLaps(sanitizePoints(pts).points, { ...circleTrack, direction: "any" });
    expect(laps.filter((l) => l.isTimed).length).toBeGreaterThanOrEqual(1);
  });

  it("does not time across a GPS jump at the line", () => {
    const pts = genCircle({ durationMs: LAP_MS * 1.3 });
    // replace the points around the first crossing with a far-away jump sequence
    const idx = pts.findIndex((p, i) => i > 0 && p.latitude > polar(0).latitude && pts[i - 1]!.latitude <= polar(0).latitude);
    pts[idx] = { ...pts[idx]!, latitude: pts[idx]!.latitude + 0.02 };
    const { laps } = detectLaps(sanitizePoints(pts).points, circleTrack);
    expect(laps.every((l) => !l.isTimed || Math.abs(l.endTime - l.startTime - LAP_MS) < 2000)).toBe(true);
  });

  it("still detects laps with poor accuracy points (flagged, not dropped)", () => {
    const { laps } = detectLaps(sanitizePoints(genCircle({ durationMs: LAP_MS * 2.2, accuracy: 45 })).points, circleTrack);
    expect(laps.filter((l) => l.isTimed)).toHaveLength(2);
  });

  it("placeholder track (degenerate line) yields one untimed lap", () => {
    const track = { ...circleTrack, startFinishLine: { pointA: polar(0), pointB: polar(0) } };
    const { laps } = detectLaps(sanitizePoints(threeLaps()).points, track);
    expect(laps).toHaveLength(1);
    expect(laps[0]!.isTimed).toBe(false);
  });
});

describe("detectLap (live, incremental)", () => {
  it("fires on crossing and respects cooldown", () => {
    const { points } = sanitizePoints(threeLaps());
    let last: number | null = null;
    let count = 0;
    for (let i = 1; i < points.length; i++) {
      const c = detectLap(points[i - 1]!, points[i]!, circleTrack, last);
      if (c) {
        last = c.timestamp;
        count++;
      }
    }
    expect(count).toBe(4); // out-lap end + 3 timed
  });
});

describe("detectSector", () => {
  it("splits a timed lap into three ~equal sectors", () => {
    const { points } = sanitizePoints(threeLaps());
    const lap = detectLaps(points, circleTrack).laps.find((l) => l.isTimed)!;
    const splits = detectSector(points, circleTrack, lap);
    expect(splits.map((s) => s.sectorId)).toEqual(["S1", "S2", "S3"]);
    for (const s of splits) expect(Math.abs(s.timeMs! - LAP_MS / 3)).toBeLessThan(80);
    expect(splits.reduce((a, s) => a + s.timeMs!, 0)).toBeCloseTo(lap.endTime - lap.startTime, 0);
  });
  it("returns null for unconfigured sector boundaries (no guessing)", () => {
    const track = { ...circleTrack, sectors: [{ id: "S1", name: "S1" }, { id: "S2", name: "S2" }] };
    const { points } = sanitizePoints(threeLaps());
    const lap = detectLaps(points, track).laps.find((l) => l.isTimed)!;
    const splits = detectSector(points, track, lap);
    expect(splits[0]!.timeMs).toBeNull();
    expect(splits[1]!.timeMs).toBeNull();
  });
});

describe("calculateLapMetrics", () => {
  it("computes time, distance, speeds", () => {
    const { points } = sanitizePoints(threeLaps());
    const lap = detectLaps(points, circleTrack).laps.find((l) => l.isTimed)!;
    const m = calculateLapMetrics(points, lap);
    expect(Math.abs(m.distanceMeters - 2 * Math.PI * 400)).toBeLessThan(15);
    expect(m.maxSpeedKmh).toBeCloseTo(144, 0);
    expect(m.averageSpeedKmh).toBeGreaterThan(140);
    expect(m.gpsQuality.rating).toBe("good");
    expect(m.gpsQuality.pointCount).toBeGreaterThan(55);
  });
  it("derives speed when device speed is missing (and altitude missing)", () => {
    const { points } = sanitizePoints(genCircle({ durationMs: LAP_MS * 2.2, speed: false, altitude: false }));
    const lap = detectLaps(points, circleTrack).laps.find((l) => l.isTimed)!;
    const m = calculateLapMetrics(points, lap);
    expect(m.maxSpeedKmh).toBeGreaterThan(135);
    expect(m.maxSpeedKmh).toBeLessThan(150);
    expect(m.gpsQuality.speedFromDevicePct).toBe(0);
  });
  it("reports poor quality for bad accuracy", () => {
    const { points } = sanitizePoints(genCircle({ durationMs: LAP_MS * 2.2, accuracy: 40 }));
    const lap = detectLaps(points, circleTrack).laps.find((l) => l.isTimed)!;
    expect(calculateLapMetrics(points, lap).gpsQuality.rating).toBe("poor");
  });
});

describe("session / corners / compare", () => {
  it("processSession builds a summary with theoretical best", () => {
    const s = processSession(threeLaps(), circleTrack);
    expect(s.summary.timedLaps).toBe(3);
    expect(s.summary.theoreticalBestMs).not.toBeNull();
    expect(s.summary.theoreticalBestMs!).toBeLessThanOrEqual(s.summary.bestLap!.lapTimeMs + 1);
  });

  it("corner analysis finds the slow point and reports estimates as ranges", () => {
    // slow to 15 m/s around the apex at 90° (quarter lap from start angle)
    const pts = genCircle({
      durationMs: LAP_MS * 2.5,
      speedMs: (_t, phase) => {
        const dist = Math.abs(Math.atan2(Math.sin(phase - Math.PI / 2), Math.cos(phase - Math.PI / 2)));
        return dist < 0.4 ? 15 + (dist / 0.4) * 25 : 40;
      },
    });
    const s = processSession(pts, circleTrack);
    const lap = s.laps.find((l) => l.isTimed)!;
    const c = analyzeCorner(sliceTrajectory(s.points, lap.startTime, lap.endTime), circleTrack.corners[0]!);
    expect(c.found).toBe(true);
    expect(c.minimumSpeedKmh.value!).toBeLessThan(70);
    expect(c.entrySpeedKmh.value!).toBeGreaterThan(c.minimumSpeedKmh.value!);
    expect(c.brakingZone?.kind).toBe("estimated");
    expect(c.brakingZone!.maxMetersBeforeApex).toBeGreaterThan(c.brakingZone!.minMetersBeforeApex);
    expect(c.brakingZone!.minMetersBeforeApex % 5).toBe(0); // no false precision
  });

  it("compareLaps: B minus A convention", () => {
    const s = processSession(threeLaps(), circleTrack);
    const [a, b] = s.laps.filter((l) => l.isTimed);
    const mk = (l: typeof a) => ({ id: String(l!.lapNumber), lapNumber: l!.lapNumber, metrics: l!.metrics, points: sliceTrajectory(s.points, l!.startTime, l!.endTime) });
    const cmp = compareLaps(mk(a), mk(b), circleTrack.corners);
    expect(cmp.lapTimeDeltaMs).toBe(b!.metrics.lapTimeMs - a!.metrics.lapTimeMs);
    expect(cmp.segments.length).toBe(20);
    expect(Math.abs(cmp.lapTimeDeltaMs)).toBeLessThan(100);
  });

  it("formatLapTime", () => {
    expect(formatLapTime(115_992)).toBe("1:55.992");
    expect(formatLapTime(null)).toBe("--:--.---");
  });
});
