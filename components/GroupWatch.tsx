"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TrackDefinition } from "@/lib/types";
import { api } from "@/lib/client/api";
import { riderStatus, useGroupFeed, type RiderStatus } from "@/hooks/useGroupFeed";
import { listSessionMetas, saveSessionMeta, type LocalSessionMeta } from "@/lib/client/localStore";
import { formatLapTime } from "@/lib/telemetry/analysis";
import { getTrack } from "@/tracks";
import { TrackMap, type MapLine, type MapRider } from "@/components/TrackMap";
import { ShareLiveButton } from "@/components/ShareLiveButton";
import { Empty, Panel } from "@/components/ui";

const POLL_MS = 3_000;
const NAME_KEY = "tc.riderName";

const STATUS_STYLE: Record<RiderStatus, string> = {
  waiting: "text-dim",
  live: "text-go",
  delayed: "text-flag",
  offline: "text-red",
  finished: "text-dim",
};

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
  const { group, riders, err: feedErr } = useGroupFeed(groupId, POLL_MS);
  const [joinErr, setErr] = useState<string | null>(null);
  const err = joinErr ?? feedErr;
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [mine, setMine] = useState<LocalSessionMeta | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);

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
