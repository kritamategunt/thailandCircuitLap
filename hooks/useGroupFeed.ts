"use client";
import { useEffect, useRef, useState } from "react";
import type { GPSPoint } from "@/lib/types";
import { api, type Group, type GroupRider } from "@/lib/client/api";

const TRAIL_POINTS = 300;
/** Same thresholds as the single-rider view (LiveWatch). */
const LIVE_MS = 15_000;
const OFFLINE_MS = 120_000;
/** Rider colours by join order — distinct on the dark satellite map. */
const COLORS = ["#3ad7ff", "#ff4fd8", "#ffd23a", "#19e27a", "#ff7a3a", "#a78bfa", "#f87171", "#e5e7eb"];

export type RiderStatus = "waiting" | "live" | "delayed" | "offline" | "finished";
export type FeedRider = Omit<GroupRider, "points" | "latest"> & { trail: GPSPoint[]; color: string };

/** Append new fixes, dropping duplicates (polls overlap) and keeping time order. */
function mergeTrail(trail: GPSPoint[], points: GPSPoint[]): GPSPoint[] {
  if (points.length === 0) return trail;
  const byTs = new Map(trail.map((p) => [p.timestamp, p]));
  for (const p of points) byTs.set(p.timestamp, p);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-TRAIL_POINTS);
}

export function riderStatus(r: FeedRider, now: number): RiderStatus {
  if (r.status === "completed") return "finished";
  const last = r.trail[r.trail.length - 1];
  if (!last) return "waiting";
  const age = now - last.timestamp;
  return age < LIVE_MS ? "live" : age < OFFLINE_MS ? "delayed" : "offline";
}

/** Polls /api/groups/:id/live and keeps every rider's recent trail (shared by the group page and the rider's live screen). */
export function useGroupFeed(groupId: string | null | undefined, pollMs = 3_000) {
  const [group, setGroup] = useState<Group | null>(null);
  const [riders, setRiders] = useState<FeedRider[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const since = useRef(0);

  useEffect(() => {
    if (!groupId) return;
    since.current = 0;
    let stop = false;
    let handle: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const r = await api.groupLive(groupId!, since.current);
          if (stop) return;
          const first = since.current === 0;
          since.current = r.serverTime;
          setErr(null);
          setGroup(r.group);
          setRiders((prev) => {
            const old = new Map(prev.map((p) => [p.sessionId, p]));
            return r.riders.map(({ points, latest, ...info }, i) => {
              const seed = first && latest && points.length === 0 ? [{ ...latest, accuracy: 0 }] : [];
              return { ...info, color: COLORS[i % COLORS.length]!, trail: mergeTrail(old.get(info.sessionId)?.trail ?? seed, points) };
            });
          });
        } catch (e) {
          if (!stop) setErr(e instanceof Error ? e.message : "Connection problem");
        }
      }
      if (!stop) handle = setTimeout(poll, pollMs);
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(handle);
    };
  }, [groupId, pollMs]);

  return { group, riders, err };
}
