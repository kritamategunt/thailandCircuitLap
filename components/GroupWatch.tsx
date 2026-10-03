"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GPSPoint, TrackDefinition } from "@/lib/types";
import { api, type Group, type GroupRider } from "@/lib/client/api";
import { listSessionMetas, saveSessionMeta, type LocalSessionMeta } from "@/lib/client/localStore";
import { formatLapTime } from "@/lib/telemetry/analysis";
import { getTrack } from "@/tracks";
import { TrackMap, type MapLine, type MapRider } from "@/components/TrackMap";
import { ShareLiveButton } from "@/components/ShareLiveButton";
import { Empty, Panel } from "@/components/ui";

const POLL_MS = 3_000;
const TRAIL_POINTS = 300;
/** Same thresholds as the single-rider view (LiveWatch). */
const LIVE_MS = 15_000;
const OFFLINE_MS = 120_000;
const NAME_KEY = "tc.riderName";
/** Rider colours by join order — distinct on the dark satellite map. */
const COLORS = ["#3ad7ff", "#ff4fd8", "#ffd23a", "#19e27a", "#ff7a3a", "#a78bfa", "#f87171", "#e5e7eb"];

type Status = "waiting" | "live" | "delayed" | "offline" | "finished";
const STATUS_STYLE: Record<Status, string> = {
  waiting: "text-dim",
  live: "text-go",
  delayed: "text-flag",
  offline: "text-red",
  finished: "text-dim",
};

type Rider = Omit<GroupRider, "points" | "latest"> & {
  trail: GPSPoint[];
  color: string;
};

/** Append new fixes, dropping duplicates (polls overlap) and keeping time order. */
function mergeTrail(trail: GPSPoint[], points: GPSPoint[]): GPSPoint[] {
  if (points.length === 0) return trail;
  const byTs = new Map(trail.map((p) => [p.timestamp, p]));
  for (const p of points) byTs.set(p.timestamp, p);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-TRAIL_POINTS);
}

function riderStatus(r: Rider, now: number): Status {
  if (r.status === "completed") return "finished";
  const last = r.trail[r.trail.length - 1];
  if (!last) return "waiting";
  const age = now - last.timestamp;
  return age < LIVE_MS ? "live" : age < OFFLINE_MS ? "delayed" : "offline";
}

/**
 * Group view: everyone who joined /group/<id> on one map + a leaderboard. Anyone with the link
 * can watch; "Join & ride" starts a normal recording session tagged with the group.
 */
export function GroupWatch({
  groupId,
  focusJoin = false,
}: {
  groupId: string;
  /** Opened via a Join button (?join=1): put the cursor in the name field. */
  focusJoin?: boolean;
}) {
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [mine, setMine] = useState<LocalSessionMeta | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const since = useRef(0);

  useEffect(() => {
    let stop = false;
    let handle: ReturnType<typeof setTimeout>;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const r = await api.groupLive(groupId, since.current);
          if (stop) return;
          const first = since.current === 0;
          since.current = r.serverTime;
          setErr(null);
          setGroup(r.group);
          setRiders((prev) => {
            const old = new Map(prev.map((p) => [p.sessionId, p]));
            return r.riders.map(({ points, latest, ...info }, i) => {
              const seed = first && latest && points.length === 0 ? [{ ...latest, accuracy: 0 }] : [];
              return {
                ...info,
                color: COLORS[i % COLORS.length]!,
                trail: mergeTrail(old.get(info.sessionId)?.trail ?? seed, points),
              };
            });
          });
        } catch (e) {
          if (!stop) setErr(e instanceof Error ? e.message : "Connection problem");
        }
      }
      if (!stop) handle = setTimeout(poll, POLL_MS);
    }
    void poll();
    return () => {
      stop = true;
      clearTimeout(handle);
    };
  }, [groupId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    listSessionMetas()
      .then((ms) => setMine(ms.find((m) => m.groupId === groupId && m.status === "active") ?? null))
      .catch(() => {});
    try {
      setName(localStorage.getItem(NAME_KEY) ?? "");
    } catch {}
  }, [groupId]);

  const track: TrackDefinition | undefined = group ? getTrack(group.trackId) : undefined;

  const board = useMemo(
    () =>
      [...riders].sort(
        (a, b) => (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || b.timedLaps - a.timedLaps || a.startedAt.localeCompare(b.startedAt),
      ),
    [riders],
  );
  const lines: MapLine[] = useMemo(
    () =>
      riders
        .filter((r) => r.trail.length > 1)
        .map((r) => ({
          id: `trail-${r.sessionId}`,
          coords: r.trail.map((p) => [p.longitude, p.latitude] as [number, number]),
          color: r.color,
          width: 3,
        })),
    [riders],
  );
  const dots: MapRider[] = useMemo(() => {
    const out = riders.flatMap((r) => {
      const last = r.trail[r.trail.length - 1];
      return last
        ? [
            {
              id: r.sessionId,
              lng: last.longitude,
              lat: last.latitude,
              label: r.name ?? "Rider",
              color: r.color,
            },
          ]
        : [];
    });
    // TrackMap follows the first rider.
    return selected ? [...out.filter((d) => d.id === selected), ...out.filter((d) => d.id !== selected)] : out;
  }, [riders, selected]);

  async function join() {
    if (!group) return;
    setJoining(true);
    setErr(null);
    const riderName = name.trim() || "Rider";
    try {
      try {
        localStorage.setItem(NAME_KEY, riderName);
      } catch {}
      const { session, writeToken } = await api.createSession(group.trackId, riderName, group.id);
      await saveSessionMeta({
        id: session.id,
        trackId: session.trackId,
        name: riderName,
        writeToken,
        startedAt: session.startedAt,
        status: "active",
        groupId: group.id,
      });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not join (are you online?)");
      setJoining(false);
    }
  }

  if (err && !group) return <p className="text-red">{err === "Group not found" ? "This group link doesn't exist." : err}</p>;
  if (!group || !track) return <Empty>Connecting…</Empty>;

  const liveCount = riders.filter((r) => riderStatus(r, now) === "live").length;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.3em] text-flag uppercase">{track.name}</p>
          <h1 className="truncate text-2xl font-black">{group.name ?? "Group ride"}</h1>
          <p className="text-xs text-dim">
            {riders.length} rider{riders.length === 1 ? "" : "s"} · {liveCount} live{err && ` · ${err}`}
          </p>
        </div>
        <ShareLiveButton path={`/group/${group.id}`} title={`Ride with us: ${group.name ?? track.name}`} label="Invite" />
      </div>

      {mine ? (
        <Link
          href={`/session/${mine.id}`}
          className="block w-full rounded-xl bg-go py-4 text-center text-lg font-black tracking-widest text-black uppercase"
        >
          Back to my session
        </Link>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus={focusJoin}
            maxLength={80}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-3 py-2 text-sm"
          />
          <button
            disabled={joining}
            className="shrink-0 rounded bg-flag px-4 text-sm font-black tracking-widest text-black uppercase disabled:opacity-50"
          >
            {joining ? "Joining…" : "Join & ride"}
          </button>
        </form>
      )}

      {track.free && <p className="text-xs text-flag">Free road — each rider sets their own start/finish. Obey traffic law.</p>}

      <TrackMap
        track={track}
        lines={lines}
        riders={dots}
        follow={selected != null}
        draftLines={riders.flatMap((r) => (r.startFinish ? [r.startFinish] : []))}
        height="50vh"
      />

      <Panel
        title="Leaderboard"
        right={
          selected && (
            <button onClick={() => setSelected(null)} className="text-xs font-bold text-flag uppercase">
              Stop following
            </button>
          )
        }
      >
        {board.length === 0 ? (
          <Empty>No riders yet. Share the invite link, then tap Join &amp; ride.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {board.map((r, i) => {
              const st = riderStatus(r, now);
              const last = r.trail[r.trail.length - 1];
              const speed = st === "live" && last?.speed != null ? `${Math.round(last.speed * 3.6)} km/h` : null;
              return (
                <li key={r.sessionId}>
                  <button
                    onClick={() => setSelected(selected === r.sessionId ? null : r.sessionId)}
                    className={`flex w-full items-center gap-2 py-2 text-left ${selected === r.sessionId ? "bg-line/50" : ""}`}
                  >
                    <span className="timing w-5 text-center text-dim">{r.bestLapMs != null ? i + 1 : "–"}</span>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name ?? "Rider"}</span>
                      <span className={`text-[11px] font-bold uppercase ${STATUS_STYLE[st]}`}>
                        {st === "live" ? "● live" : st}
                        {speed && <span className="text-dim"> · {speed}</span>}
                        <span className="text-dim"> · {r.timedLaps} laps</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="timing block font-bold text-best">{formatLapTime(r.bestLapMs)}</span>
                      <span className="timing block text-[11px] text-dim">last {formatLapTime(r.lastLapMs)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-dim">
        Updates every {POLL_MS / 1000}s; positions lag riders by a few seconds and lap times by up to 30s. Tap a rider to follow them on the map
        {selected && (
          <>
            {" "}
            or{" "}
            <Link href={`/live/${selected}`} className="text-flag underline">
              open their live screen
            </Link>
          </>
        )}
        .
      </p>
    </div>
  );
}
