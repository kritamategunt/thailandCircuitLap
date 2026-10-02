import type { TrackDefinition } from "@/lib/types";
import { thailandCircuit } from "./thailand-circuit";

export const TRACKS: Record<string, TrackDefinition> = {
  [thailandCircuit.id]: thailandCircuit,
};

export const DEFAULT_TRACK_ID = thailandCircuit.id;

export function getTrack(trackId: string): TrackDefinition | undefined {
  return TRACKS[trackId];
}
