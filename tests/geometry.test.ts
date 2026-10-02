import { describe, expect, it } from "vitest";
import { calculateDistance, hasCrossedLine, isValidCoordinate, pathDistance } from "@/lib/telemetry";
import { CENTER, polar, radialLine } from "./helpers";

describe("calculateDistance", () => {
  it("1 degree of latitude ≈ 111.2 km", () => {
    const d = calculateDistance({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });
  it("zero for identical points", () => {
    expect(calculateDistance(CENTER, CENTER)).toBe(0);
  });
  it("is symmetric and matches local scale", () => {
    const a = polar(0, 100);
    const b = polar(Math.PI, 100);
    expect(calculateDistance(a, b)).toBeCloseTo(200, 0);
    expect(calculateDistance(a, b)).toBeCloseTo(calculateDistance(b, a), 6);
  });
  it("pathDistance sums segments", () => {
    expect(pathDistance([polar(0, 0), polar(0, 100), polar(0, 300)])).toBeCloseTo(300, 0);
  });
  it("validates coordinate ranges", () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isValidCoordinate({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: -90, longitude: 180 })).toBe(true);
  });
});

describe("hasCrossedLine", () => {
  const line = radialLine(0); // A inner (west), B outer (east), at angle 0
  const south = polar(-0.01); // ~4 m south of the line on the circle
  const north = polar(0.01);

  it("detects a forward crossing (south -> north = right-to-left of A->B)", () => {
    expect(hasCrossedLine(south, north, line)?.direction).toBe("right-to-left");
  });
  it("reports backwards crossing direction", () => {
    expect(hasCrossedLine(north, south, line)?.direction).toBe("left-to-right");
  });
  it("interpolates crossing position along the segment", () => {
    const hit = hasCrossedLine(south, north, line)!;
    expect(hit.t).toBeGreaterThan(0.45);
    expect(hit.t).toBeLessThan(0.55);
  });
  it("ignores segments that miss the line extent", () => {
    expect(hasCrossedLine(polar(-0.01, 450), polar(0.01, 450), line)).toBeNull();
  });
  it("tolerance extends the line", () => {
    expect(hasCrossedLine(polar(-0.01, 412), polar(0.01, 412), line, 5)).not.toBeNull();
  });
  it("ignores segments on one side", () => {
    expect(hasCrossedLine(polar(0.01), polar(0.02), line)).toBeNull();
  });
  it("degenerate (placeholder) line never crosses", () => {
    expect(hasCrossedLine(south, north, { pointA: CENTER, pointB: CENTER })).toBeNull();
  });
});
