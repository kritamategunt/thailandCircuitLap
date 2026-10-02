"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type SessionDetail } from "@/lib/client/api";
import { getSessionMeta, listSessionMetas, type LocalSessionMeta } from "@/lib/client/localStore";
import { getTrack } from "@/tracks";
import { Delta, Empty, LapTime, Panel, QualityBadge, Stat, UncalibratedBanner } from "@/components/ui";

export function LapHistory({ sessionId }: { sessionId: string | null }) {
  const router = useRouter();
  const [metas, setMetas] = useState<LocalSessionMeta[]>([]);
  const [data, setData] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSessionMetas().then(setMetas).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!sessionId) return;
    setErr(null);
    api.session(sessionId).then(setData).catch((e: Error) => setErr(e.message));
    getSessionMeta(sessionId).then((m) => setToken(m?.writeToken ?? null)).catch(() => {});
  }, [sessionId]);
  useEffect(load, [load]);

  if (!sessionId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black">Lap history</h1>
        <Panel title="Choose a session">
          {metas.length === 0 ? (
            <Empty>No sessions on this device.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {metas.map((m) => (
                <li key={m.id}>
                  <Link href={`/laps?session=${m.id}`} className="block py-3 font-semibold">
                    {m.name ?? m.id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  const laps = data?.laps ?? [];
  const sectorIds = getTrack(data?.track.id ?? "")?.sectors.map((s) => s.id) ?? ["S1", "S2", "S3"];
  const best = data?.summary?.bestLap?.lapTimeMs ?? null;
  const bestSectors = data?.summary?.bestSectors ?? {};

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]));
  }

  async function retime() {
    if (!sessionId || !token) return;
    setBusy(true);
    try {
      await api.recompute(sessionId, token);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-black">Lap history</h1>
          <p className="truncate text-xs text-dim">{data?.session.name ?? sessionId}</p>
        </div>
        <div className="flex gap-2">
          {token && (
            <button onClick={retime} disabled={busy} className="rounded bg-line px-3 py-2 text-xs font-bold uppercase disabled:opacity-50">
              {busy ? "…" : "Re-time"}
            </button>
          )}
          <Link href={`/track?session=${sessionId}`} className="rounded bg-line px-3 py-2 text-xs font-bold uppercase">
            Map
          </Link>
        </div>
      </div>
      {data && !data.track.verified && <UncalibratedBanner trackId={data.track.id} />}
      {err && <p className="text-sm text-red">{err}</p>}

      {data?.summary && (
        <Panel>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Best" value={<LapTime ms={best} best />} />
            <Stat label="Theoretical" value={<LapTime ms={data.summary.theoreticalBestMs} />} />
            <Stat label="Timed laps" value={data.summary.timedLaps} />
            <Stat label="Consistency σ" value={data.summary.consistencyStdDevMs == null ? "—" : (data.summary.consistencyStdDevMs / 1000).toFixed(2)} unit="s" />
          </div>
        </Panel>
      )}

      <Panel
        title="Laps"
        right={
          <button
            disabled={selected.length !== 2}
            onClick={() => router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)}
            className="rounded bg-flag px-3 py-1.5 text-xs font-black text-black uppercase disabled:opacity-30"
          >
            Compare {selected.length}/2
          </button>
        }
      >
        {!data ? (
          <Empty>Loading…</Empty>
        ) : laps.length === 0 ? (
          <Empty>No laps yet. Points may still be uploading, or the track needs calibration.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="timing w-full min-w-[560px] text-sm">
              <thead className="text-[10px] tracking-widest text-dim uppercase">
                <tr className="border-b border-line">
                  <th className="w-8 py-2" />
                  <th className="py-2 text-left">Lap</th>
                  <th className="text-right">Time</th>
                  <th className="text-right">Δ Best</th>
                  <th className="text-right">Max</th>
                  {sectorIds.map((s) => (
                    <th key={s} className="text-right">
                      {s}
                    </th>
                  ))}
                  <th className="pr-4 text-right">GPS</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((l) => {
                  const isBest = l.isTimed && l.metrics.lapTimeMs === best;
                  return (
                    <tr key={l.id} className={`border-b border-line/60 ${selected.includes(l.id) ? "bg-flag/10" : ""}`}>
                      <td className="py-2 pl-4">
                        <input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-[#ffd500]" />
                      </td>
                      <td>
                        <Link href={`/laps/${l.id}`} className="font-bold underline-offset-2 hover:underline">
                          {l.lapNumber}
                        </Link>
                        {!l.isTimed && <span className="ml-1 text-[10px] text-dim uppercase">{l.kind}</span>}
                      </td>
                      <td className="text-right">{l.isTimed ? <LapTime ms={l.metrics.lapTimeMs} best={isBest} /> : <span className="text-dim">—</span>}</td>
                      <td className="text-right">{l.isTimed && best != null ? <Delta ms={l.metrics.lapTimeMs - best} /> : "—"}</td>
                      <td className="text-right">{Math.round(l.metrics.maxSpeedKmh)}</td>
                      {sectorIds.map((s) => {
                        const t = l.metrics.sectorTimes[s];
                        const sb = bestSectors[s]?.timeMs;
                        return (
                          <td key={s} className={`text-right ${t != null && t === sb ? "text-best" : ""}`}>
                            {t == null ? "—" : (t / 1000).toFixed(2)}
                          </td>
                        );
                      })}
                      <td className="pr-4 text-right">
                        <QualityBadge rating={l.metrics.gpsQuality.rating} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-dim">Purple = personal best. Select two laps to compare. Tap a lap number for analysis.</p>
    </div>
  );
}
