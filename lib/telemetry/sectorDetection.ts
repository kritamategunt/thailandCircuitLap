import type { CleanPoint, DetectedLap, LineCrossing, TrackDefinition } from "@/lib/types";
import { findLineCrossings } from "./lineCrossing";

export type SectorSplit = {
  sectorId: string;
  startTime: number | null;
  endTime: number | null;
  timeMs: number | null;
};

/** Crossings of every configured sector end-line across the whole trajectory (computed once per session). */
export function findSectorCrossings(points: CleanPoint[], track: TrackDefinition): Record<string, LineCrossing[]> {
  const out: Record<string, LineCrossing[]> = {};
  for (const s of track.sectors) {
    out[s.id] = s.endLine ? findLineCrossings(points, s.endLine, track.lineToleranceMeters) : [];
  }
  return out;
}

/**
 * Sector splits for one lap. Sector i ends at the FIRST crossing of its end-line after
 * sector i-1 ended; the last sector ends at the lap end (start/finish).
 * If a boundary is missing, that sector and the next one are null (no guessing).
 */
export function splitLapIntoSectors(
  lap: Pick<DetectedLap, "startTime" | "endTime" | "isTimed">,
  track: TrackDefinition,
  sectorCrossings: Record<string, LineCrossing[]>,
): SectorSplit[] {
  const splits: SectorSplit[] = [];
  let cursor: number | null = lap.isTimed ? lap.startTime : null;
  track.sectors.forEach((s, idx) => {
    const isLast = idx === track.sectors.length - 1;
    let end: number | null = null;
    if (isLast) {
      end = lap.isTimed ? lap.endTime : null;
    } else if (cursor != null) {
      const c = (sectorCrossings[s.id] ?? []).find((x) => x.timestamp > cursor! && x.timestamp < lap.endTime);
      end = c ? c.timestamp : null;
    }
    const timeMs = cursor != null && end != null ? end - cursor : null;
    splits.push({ sectorId: s.id, startTime: cursor, endTime: end, timeMs });
    cursor = end;
  });
  return splits;
}

/** Convenience: sector splits for a single lap straight from points. */
export function detectSector(points: CleanPoint[], track: TrackDefinition, lap: DetectedLap): SectorSplit[] {
  return splitLapIntoSectors(lap, track, findSectorCrossings(points, track));
}
