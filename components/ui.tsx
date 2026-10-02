import type { ReactNode } from "react";
import { formatDelta, formatLapTime } from "@/lib/telemetry/analysis";

export function Panel({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-xs font-bold tracking-widest text-dim uppercase">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, tone }: { label: string; value: ReactNode; unit?: string; tone?: "best" | "go" | "red" | "flag" }) {
  const color = tone === "best" ? "text-best" : tone === "go" ? "text-go" : tone === "red" ? "text-red" : tone === "flag" ? "text-flag" : "text-ink";
  return (
    <div>
      <div className="text-[10px] font-bold tracking-widest text-dim uppercase">{label}</div>
      <div className={`timing text-xl font-bold ${color}`}>
        {value}
        {unit && <span className="ml-1 text-xs text-dim">{unit}</span>}
      </div>
    </div>
  );
}

export function Delta({ ms, dp = 2 }: { ms: number | null | undefined; dp?: number }) {
  const color = ms == null ? "text-dim" : ms < 0 ? "text-go" : ms > 0 ? "text-red" : "text-ink";
  return <span className={`timing ${color}`}>{formatDelta(ms, dp)}</span>;
}

export function LapTime({ ms, best }: { ms: number | null | undefined; best?: boolean }) {
  return <span className={`timing ${best ? "text-best" : ""}`}>{formatLapTime(ms)}</span>;
}

export function QualityBadge({ rating }: { rating: "good" | "medium" | "poor" | "fair" | "none" }) {
  const cls =
    rating === "good" ? "bg-go/15 text-go" : rating === "poor" || rating === "none" ? "bg-red/15 text-red" : "bg-flag/15 text-flag";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${cls}`}>{rating}</span>;
}

export function UncalibratedBanner() {
  return (
    <div className="rounded-md border border-flag/40 bg-flag/10 px-3 py-2 text-xs text-flag">
      Track geometry is a <b>placeholder</b> — laps won&apos;t be detected until start/finish is calibrated.{" "}
      <a href="/track?calibrate=1" className="font-bold underline">
        Calibrate
      </a>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-dim">{children}</p>;
}
