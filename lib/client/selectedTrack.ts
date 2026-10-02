"use client";
import { useEffect, useState } from "react";
import type { TrackDefinition } from "@/lib/types";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { api } from "@/lib/client/api";
import { withStartFinish } from "@/lib/telemetry/freeRoad";

const KEY = "tc.selectedTrackId";

/** Track the user picked on this device (localStorage; falls back to the default track). */
export function useSelectedTrack(): [TrackDefinition, (id: string) => void] {
  const [id, setId] = useState(DEFAULT_TRACK_ID);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && getTrack(saved)) setId(saved);
    } catch {}
  }, []);
  const select = (next: string) => {
    if (!getTrack(next)) return;
    setId(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  };
  return [getTrack(id)!, select];
}

/** Track a session was recorded on (undefined while loading or when unknown). */
export function useSessionTrack(sessionId: string | null | undefined): TrackDefinition | undefined {
  const [track, setTrack] = useState<TrackDefinition | undefined>(undefined);
  useEffect(() => {
    if (!sessionId) return;
    api
      .session(sessionId)
      .then((s) => {
        const t = getTrack(s.track.id);
        setTrack(t && withStartFinish(t, s.startFinish));
      })
      .catch(() => {});
  }, [sessionId]);
  return track;
}
