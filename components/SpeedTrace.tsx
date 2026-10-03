"use client";
import { useId } from "react";
import { SPEED_COLORS, speedRange } from "@/components/speedColors";

export type TraceSeries = { label: string; color: string; points: Array<{ d: number; v: number | null }> };

/**
 * Minimal dependency-free speed chart (SVG), x = distance by default.
 * `bySpeed` colours a single series with the map's speed scale (red slow -> green fast).
 */
export function SpeedTrace({
  series,
  height = 180,
  bySpeed = false,
  xLabel = "km/h vs distance (m)",
  xUnit = "m",
}: {
  series: TraceSeries[];
  height?: number;
  bySpeed?: boolean;
  xLabel?: string;
  xUnit?: string;
}) {
  const gradientId = `speed-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const W = 1000;
  const H = height;
  const pad = { l: 36, r: 8, t: 8, b: 20 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="py-6 text-center text-sm text-dim">No speed trace.</p>;
  const maxD = Math.max(...series.map((s) => s.points[s.points.length - 1]?.d ?? 0), 1);
  const maxV = Math.max(...all.map((p) => p.v ?? 0), 50);
  const vTop = Math.ceil(maxV / 50) * 50;
  const x = (d: number) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / vTop) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: vTop / 50 + 1 }, (_, i) => i * 50);
  const range = bySpeed && series.length === 1 ? speedRange(all.map((p) => p.v)) : null;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {range && (
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={y(range.lo)} y2={y(range.hi)}>
              {SPEED_COLORS.map((c, i) => (
                <stop key={c} offset={i / (SPEED_COLORS.length - 1)} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#26262b" strokeWidth={1} />
            <text x={4} y={y(t) + 4} fill="#8b8b94" fontSize={11} fontFamily="ui-monospace">
              {t}
            </text>
          </g>
        ))}
        {series.map((s) => {
          let dPath = "";
          let pen = false;
          for (const p of s.points) {
            if (p.v == null) {
              pen = false;
              continue;
            }
            dPath += `${pen ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`;
            pen = true;
          }
          return <path key={s.label} d={dPath} fill="none" stroke={range ? `url(#${gradientId})` : s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-dim">
        <span>{xLabel}</span>
        <span className="flex gap-3">
          {!range &&
            series.map((s) => (
              <span key={s.label} style={{ color: s.color }}>
                ● {s.label}
              </span>
            ))}
          {range && <span>red slow · green fast</span>}
          <span>
            {Math.round(maxD)} {xUnit}
          </span>
        </span>
      </div>
    </div>
  );
}
