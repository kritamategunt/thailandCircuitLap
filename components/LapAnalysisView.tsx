"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type LapDetail } from "@/lib/client/api";
import type { LapAnalysis } from "@/lib/telemetry/analysis";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { useSessionTrack } from "@/lib/client/selectedTrack";
import { TrackMap, type MapLine } from "@/components/TrackMap";
import { SpeedTrace } from "@/components/SpeedTrace";
import { Delta, Empty, LapTime, Panel, QualityBadge, Stat } from "@/components/ui";

export function LapAnalysisView({ lapId }: { lapId: string }) {
  const [lap, setLap] = useState<LapDetail | null>(null);
  const [analysis, setAnalysis] = useState<LapAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.lap(lapId, true).then(setLap).catch((e: Error) => setErr(e.message));
    api.analysis(lapId).then(setAnalysis).catch(() => {});
  }, [lapId]);

  const track = useSessionTrack(lap?.lap.sessionId) ?? getTrack(DEFAULT_TRACK_ID)!;
  const lines: MapLine[] = useMemo(
    () =>
      lap?.points?.length
        ? [{ id: "lap", coords: lap.points.map((p) => [p.lng, p.lat] as [number, number]), speeds: lap.points.map((p) => p.v), color: "#fff", width: 5 }]
        : [],
    [lap],
  );

  if (err) return <p className="text-red">{err}</p>;
  if (!lap) return <Empty>Loading…</Empty>;
  const m = lap.lap.metrics;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <Link href={`/laps?session=${lap.lap.sessionId}`} className="text-xs text-dim">
            ◀ Session
          </Link>
          <h1 className="text-2xl font-black">
            Lap {lap.lap.lapNumber} {!lap.lap.isTimed && <span className="text-sm text-dim uppercase">({lap.lap.kind} lap)</span>}
          </h1>
        </div>
        <QualityBadge rating={m.gpsQuality.rating} />
      </div>

      <Panel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Lap time" value={<LapTime ms={lap.lap.isTimed ? m.lapTimeMs : null} />} />
          <Stat label="Δ best" value={<Delta ms={analysis?.bestLapDifference == null ? null : analysis.bestLapDifference * 1000} />} />
          <Stat label="Max speed" value={Math.round(m.maxSpeedKmh)} unit="km/h" />
          <Stat label="Avg speed" value={Math.round(m.averageSpeedKmh)} unit="km/h" />
          <Stat label="Distance" value={Math.round(m.distanceMeters)} unit="m" />
          <Stat label="GPS points" value={m.gpsQuality.pointCount} />
          <Stat label="Mean accuracy" value={m.gpsQuality.meanAccuracyMeters ?? "—"} unit="m" />
          <Stat label="Device speed" value={m.gpsQuality.speedFromDevicePct} unit="%" />
        </div>
      </Panel>

      <TrackMap track={track} lines={lines} height="50vh" />

      <Panel title="Speed trace">
        <SpeedTrace series={[{ label: `Lap ${lap.lap.lapNumber}`, color: "#ffd500", points: lap.points ?? [] }]} bySpeed />
      </Panel>

      <Panel title="Sectors">
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(lap.sectorTimes).map(([sid, t]) => {
            const d = analysis?.strongSectors.find((s) => s.sectorId === sid) ?? analysis?.weakSectors.find((s) => s.sectorId === sid);
            return (
              <div key={sid} className="rounded bg-bg p-3">
                <div className="text-[10px] font-bold tracking-widest text-dim">{sid}</div>
                <div className="timing text-lg font-bold">{t == null ? "—" : (t / 1000).toFixed(2)}</div>
                {d && (
                  <div className="text-xs">
                    vs best <Delta ms={d.deltaToBestMs} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {analysis && (
        <Panel title="Engineer notes (data-derived)">
          {analysis.potentialTimeLoss.length === 0 ? (
            <p className="text-sm text-dim">No clear time loss vs your best — or this is your best lap.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {analysis.potentialTimeLoss.slice(0, 5).map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {p.where} <span className="text-[10px] text-dim uppercase">{p.basis}</span>
                  </span>
                  <Delta ms={p.approxMs} />
                </li>
              ))}
            </ul>
          )}
          {analysis.corners.some((c) => c.found) && (
            <div className="mt-4 overflow-x-auto">
              <table className="timing w-full text-xs">
                <thead className="text-dim">
                  <tr>
                    <th className="text-left">Corner</th>
                    <th className="text-right">Entry</th>
                    <th className="text-right">Min</th>
                    <th className="text-right">Exit</th>
                    <th className="text-right">Brake zone (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.corners
                    .filter((c) => c.found)
                    .map((c) => (
                      <tr key={c.cornerId} className="border-t border-line/60">
                        <td className="py-1">{c.cornerId}</td>
                        <td className="text-right">{c.entrySpeedKmh.value ?? "—"}</td>
                        <td className="text-right">~{c.minimumSpeedKmh.value ?? "—"}</td>
                        <td className="text-right">{c.exitSpeedKmh.value ?? "—"}</td>
                        <td className="text-right">
                          {c.brakingZone ? `${c.brakingZone.minMetersBeforeApex}–${c.brakingZone.maxMetersBeforeApex} m (${c.brakingZone.confidence})` : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <ul className="mt-4 list-disc space-y-1 pl-4 text-xs text-dim">
            {analysis.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-dim">
            For a full debrief, ask your AI: <code className="text-ink">analyze_lap {lapId}</code> via the MCP server.
          </p>
        </Panel>
      )}
    </div>
  );
}
