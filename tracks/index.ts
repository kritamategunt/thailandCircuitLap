import type { TrackDefinition } from "@/lib/types";
import { thailandCircuit } from "./thailand-circuit";
import { kaengKrachan } from "./kaeng-krachan";
import { mspSuvarnabhumi } from "./msp-suvarnabhumi";
import { freeRoad } from "./free-road";

/** Circuits in picker display order. Each id needs a matching row in the `tracks` table. */
export const TRACK_LIST: TrackDefinition[] = [thailandCircuit, kaengKrachan, mspSuvarnabhumi];

export { freeRoad };

export const TRACKS: Record<string, TrackDefinition> = Object.fromEntries([...TRACK_LIST, freeRoad].map((t) => [t.id, t]));

export const DEFAULT_TRACK_ID = thailandCircuit.id;

export function getTrack(trackId: string): TrackDefinition | undefined {
  return TRACKS[trackId];
}
