"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type LapDetail } from "@/lib/client/api";
import type { LapComparison } from "@/lib/telemetry/compare";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { TrackMap, type MapLine } from "@/components/TrackMap";
import { SpeedTrace } from "@/components/SpeedTrace";
import { Delta, Empty, LapTime, Panel } from "@/components/ui";

const COLOR_A = "#3ad7ff";
const COLOR_B = "#ffd500";

export function CompareView({ a, b }: { a: string | null; b: string | null }) {
  const [la, setLa] = useState<LapDetail | null>(null);
  const [lb, setLb] = useState<LapDetail | null>(null);
  const [cmp, setCmp] = useState<LapComparison | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    Promise.all([api.lap(a, true), api.lap(b, true), api.compare(a, b)])
      .then(([x, y, c]) => {
        setLa(x);
        setLb(y);
        setCmp(c);
      })
      .catch((e: Error) => setErr(e.message));
  }, [a, b]);

  const track = getTrack(DEFAULT_TRACK_ID)!;
  const lines: MapLine[] = useMemo(() => {
    const mk = (d: LapDetail | null, id: string, color: string): MapLine[] =>
      d?.points?.length ? [{ id, color, width: 4, coords: d.points.map((p) => [p.lng, p.lat] as [number, number]) }] : [];
    return [...mk(la, "a", COLOR_A), ...mk(lb, "b", COLOR_B)];
  }, [la, lb]);

  if (!a || !b) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black">Compare laps</h1>
        <Empty>
          Pick two laps on the <Link href="/laps" className="text-flag underline">Laps</Link> page.
        </Empty>
      </div>
    );
  }
  if (err) return <p className="text-red">{err}</p>;
  if (!cmp || !la || !lb) return <Empty>Loading…</Empty>;

  const maxAbs = Math.max(1, ...cmp.segments.map((s) => Math.abs(s.deltaMs)));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Compare</h1>

      <Panel>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <div>
            <div className="text-xs font-bold" style={{ color: COLOR_A }}>
              LAP {cmp.lapA.lapNumber}
            </div>
            <div className="timing text-2xl font-black">
              <LapTime ms={cmp.lapA.lapTimeMs} />
            </div>
          </div>
          <div className="text-xs font-bold text-dim">VS</div>
          <div>
            <div className="text-xs font-bold" style={{ color: COLOR_B }}>
              LAP {cmp.lapB.lapNumber}
            </div>
            <div className="timing text-2xl font-black">
              <LapTime ms={cmp.lapB.lapTimeMs} />
            </div>
          </div>
        </div>
        <div className="mt-4 text-center">
          <div className="text-[10px] font-bold tracking-widest text-dim uppercase">Difference (B − A)</div>
          <div className="text-4xl font-black">
            <Delta ms={cmp.lapTimeDeltaMs} dp={3} />
            <span className="ml-1 text-base text-dim">sec</span>
          </div>
        </div>
      </Panel>

      <Panel title="Sectors">
        <div className="timing space-y-1 text-lg">
          {Object.entries(cmp.sectorDeltasMs).map(([sid, d]) => (
            <div key={sid} className="flex justify-between border-b border-line/50 py-1">
              <span className="font-bold">{sid}</span>
              <Delta ms={d} />
            </div>
          ))}
          <div className="flex justify-between pt-2 text-sm text-dim">
            <span>Max speed</span>
            <span>
              {cmp.maxSpeedDeltaKmh > 0 ? "+" : ""}
              {cmp.maxSpeedDeltaKmh} km/h
            </span>
          </div>
          <div className="flex justify-between text-sm text-dim">
            <span>Distance</span>
            <span>
              {cmp.distanceDeltaMeters > 0 ? "+" : ""}
              {cmp.distanceDeltaMeters} m
            </span>
          </div>
        </div>
      </Panel>

      <TrackMap track={track} lines={lines} height="50vh" />

      <Panel title="Speed trace">
        <SpeedTrace
          series={[
            { label: `Lap ${cmp.lapA.lapNumber}`, color: COLOR_A, points: la.points ?? [] },
            { label: `Lap ${cmp.lapB.lapNumber}`, color: COLOR_B, points: lb.points ?? [] },
          ]}
        />
      </Panel>

      <Panel title="Where time went (by 5% of lap distance)">
        <div className="space-y-1">
          {cmp.segments.map((s) => (
            <div key={s.fromPct} className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-2 text-xs">
              <span className="timing text-dim">
                {s.fromPct}–{s.toPct}%
              </span>
              <div className="relative h-3 rounded bg-bg">
                <div className="absolute top-0 left-1/2 h-full w-px bg-line" />
                <div
                  className={`absolute top-0 h-full rounded ${s.deltaMs < 0 ? "bg-go" : "bg-red"}`}
                  style={{
                    left: s.deltaMs < 0 ? `${50 - (Math.abs(s.deltaMs) / maxAbs) * 50}%` : "50%",
                    width: `${(Math.abs(s.deltaMs) / maxAbs) * 50}%`,
                  }}
                />
              </div>
              <span className="text-right">
                <Delta ms={s.deltaMs} />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-dim">{cmp.dataQuality.note}</p>
      </Panel>
    </div>
  );
}
