"use client";
import type { jsPDF as JsPDF } from "jspdf";
import type { Coordinate, TrackDefinition } from "@/lib/types";
import type { LapDetail } from "@/lib/client/api";
import { formatDelta, formatLapTime, type LapAnalysis } from "@/lib/telemetry/analysis";
import { speedColor, speedRange, type SpeedRange } from "@/components/speedColors";

/**
 * One-lap report as a downloadable A4 PDF, drawn as vectors (no map tiles, so it works offline
 * and prints cleanly): stats, the lap's line coloured by speed, speed trace, sectors, engineer notes.
 * jsPDF is loaded on demand — it only costs bandwidth when someone exports.
 */
export async function exportLapPdf({ lap, analysis, track }: { lap: LapDetail; analysis: LapAnalysis | null; track: TrackDefinition }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 15; // page margin
  const CW = W - 2 * M;
  const m = lap.lap.metrics;
  const pts = (lap.points ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const range = speedRange(pts.map((p) => p.v));
  const started = new Date(lap.lap.startTime);
  let y = M;

  const text = (s: string, x: number, yy: number, opts?: { size?: number; bold?: boolean; color?: number; align?: "left" | "right" | "center" }) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 9);
    doc.setTextColor(opts?.color ?? 20);
    doc.text(latin1(s), x, yy, { align: opts?.align ?? "left" });
  };
  const ensure = (h: number) => {
    if (y + h > 297 - M - 8) {
      doc.addPage();
      y = M;
    }
  };
  /** `need` = height of the content that follows, so a heading never ends up alone at the bottom of a page. */
  const heading = (s: string, need: number) => {
    ensure(7 + need);
    text(s.toUpperCase(), M, y + 4, { size: 8, bold: true, color: 110 });
    y += 7;
  };

  // --- Header
  text(`${track.name} · Lap report`, M, y + 4, { size: 9, bold: true, color: 110 });
  text(started.toLocaleString(), W - M, y + 4, { size: 9, color: 110, align: "right" });
  y += 12;
  text(`Lap ${lap.lap.lapNumber}${lap.lap.isTimed ? "" : ` (${lap.lap.kind} lap)`}`, M, y + 6, { size: 20, bold: true });
  text(lap.lap.isTimed ? formatLapTime(m.lapTimeMs) : "untimed", W - M, y + 6, { size: 20, bold: true, align: "right" });
  y += 10;
  if (analysis?.bestLapDifference != null)
    text(`${formatDelta(analysis.bestLapDifference * 1000)} vs session best`, W - M, y + 3, { size: 9, color: 110, align: "right" });
  y += 7;

  // --- Stats grid
  const stats: Array<[string, string]> = [
    ["Max speed", `${Math.round(m.maxSpeedKmh)} km/h`],
    ["Avg speed", `${Math.round(m.averageSpeedKmh)} km/h`],
    ["Distance", `${Math.round(m.distanceMeters)} m`],
    ["GPS quality", m.gpsQuality.rating],
    ["GPS points", String(m.gpsQuality.pointCount)],
    ["Mean accuracy", m.gpsQuality.meanAccuracyMeters == null ? "-" : `${m.gpsQuality.meanAccuracyMeters} m`],
    ["Device speed", `${m.gpsQuality.speedFromDevicePct}%`],
    ["Session best", formatLapTime(analysis?.sessionContext.bestLapMs)],
  ];
  const colW = CW / 4;
  stats.forEach(([label, value], i) => {
    const x = M + (i % 4) * colW;
    const yy = y + Math.floor(i / 4) * 12;
    text(label.toUpperCase(), x, yy + 3, { size: 7, bold: true, color: 120 });
    text(value, x, yy + 8.5, { size: 11, bold: true });
  });
  y += 26;

  // --- Track drawing
  if (pts.length > 1) {
    const h = 105;
    heading("Line coloured by speed", h);
    drawLapMap(doc, track, pts, range, { x: M, y, w: CW, h });
    y += h + 2;
    if (range) {
      drawLegend(doc, range, M, y);
      y += 9;
    }

    heading("Speed vs distance (km/h)", 52);
    drawSpeedTrace(doc, pts, range, { x: M, y: y + 2, w: CW, h: 50 });
    y += 60;
  }

  // --- Sectors
  const sectors = Object.entries(lap.sectorTimes);
  if (sectors.length) {
    heading("Sectors", 16);
    const sw = CW / Math.max(3, sectors.length);
    sectors.forEach(([sid, t], i) => {
      const x = M + i * sw;
      const d = analysis?.strongSectors.find((s) => s.sectorId === sid) ?? analysis?.weakSectors.find((s) => s.sectorId === sid);
      text(sid, x, y + 3, { size: 7, bold: true, color: 120 });
      text(t == null ? "-" : `${(t / 1000).toFixed(2)} s`, x, y + 9, { size: 11, bold: true });
      if (d) text(`${formatDelta(d.deltaToBestMs)} vs best`, x, y + 14, { size: 8, color: 110 });
    });
    y += 19;
  }

  // --- Engineer notes
  if (analysis) {
    heading("Engineer notes (data-derived)", 12);
    if (analysis.potentialTimeLoss.length === 0) {
      ensure(6);
      text("No clear time loss vs your best - or this is your best lap.", M, y + 3, { color: 90 });
      y += 7;
    } else {
      for (const p of analysis.potentialTimeLoss.slice(0, 5)) {
        ensure(6);
        text(`${p.where} (${p.basis})`, M, y + 3);
        text(formatDelta(p.approxMs), W - M, y + 3, { bold: true, align: "right" });
        y += 5.5;
      }
      y += 2;
    }

    const corners = analysis.corners.filter((c) => c.found);
    if (corners.length) {
      ensure(10);
      const cols = [M, M + 35, M + 65, M + 95, M + 125];
      ["Corner", "Entry km/h", "Min km/h", "Exit km/h", "Brake zone (est.)"].forEach((h, i) => text(h, cols[i]!, y + 3, { size: 7, bold: true, color: 120 }));
      y += 6;
      for (const c of corners) {
        ensure(5.5);
        const row = [
          c.cornerId,
          String(c.entrySpeedKmh.value ?? "-"),
          `~${c.minimumSpeedKmh.value ?? "-"}`,
          String(c.exitSpeedKmh.value ?? "-"),
          c.brakingZone ? `${c.brakingZone.minMetersBeforeApex}-${c.brakingZone.maxMetersBeforeApex} m (${c.brakingZone.confidence})` : "-",
        ];
        row.forEach((v, i) => text(v, cols[i]!, y + 3, { size: 8.5 }));
        y += 5;
      }
      y += 3;
    }

    for (const c of analysis.caveats) {
      const lines = doc.splitTextToSize(latin1(`- ${c}`), CW) as string[];
      ensure(lines.length * 3.6);
      text(lines.join("\n"), M, y + 3, { size: 7.5, color: 120 });
      y += lines.length * 3.6 + 1;
    }
  }

  // --- Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    text("TC Track Engineer · phone GPS (~1 Hz, ±3-10 m) - treat small differences as noise", M, 297 - 8, { size: 7, color: 140 });
    text(`${i}/${pages}`, W - M, 297 - 8, { size: 7, color: 140, align: "right" });
  }

  const day = started.toISOString().slice(0, 10);
  doc.save(`${track.id}-${day}-lap-${lap.lap.lapNumber}.pdf`);
}

type Box = { x: number; y: number; w: number; h: number };
type Pt = NonNullable<LapDetail["points"]>[number];

/** Built-in PDF fonts are Latin-1 only: map common symbols, drop the rest (e.g. Thai) rather than print garbage. */
function latin1(s: string): string {
  return s
    .replace(/[≈∼]/g, "~")
    .replace(/[–—−]/g, "-")
    .replace(/Δ ?/g, "Delta ")
    .replace(/→/g, "->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\xff\n]/g, "?");
}

function drawLapMap(doc: JsPDF, track: TrackDefinition, pts: Pt[], range: SpeedRange | null, box: Box) {
  doc.setDrawColor(220);
  doc.setLineWidth(0.2);
  doc.roundedRect(box.x, box.y, box.w, box.h, 2, 2);

  // Local metres around the lap's centre, fitted into the box with equal x/y scale (north up).
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const toM = (c: { lat: number; lng: number }) => ({ x: (c.lng - lng0) * kx, y: (c.lat - lat0) * 111_320 });
  const ms = pts.map(toM);
  const minX = Math.min(...ms.map((p) => p.x));
  const maxX = Math.max(...ms.map((p) => p.x));
  const minY = Math.min(...ms.map((p) => p.y));
  const maxY = Math.max(...ms.map((p) => p.y));
  const pad = 6;
  const s = Math.min((box.w - 2 * pad) / Math.max(maxX - minX, 1), (box.h - 2 * pad) / Math.max(maxY - minY, 1));
  const ox = box.x + box.w / 2 - ((minX + maxX) / 2) * s;
  const oy = box.y + box.h / 2 + ((minY + maxY) / 2) * s;
  const P = (c: { lat: number; lng: number }) => {
    const p = toM(c);
    return [ox + p.x * s, oy - p.y * s] as const;
  };
  const C = (c: Coordinate) => P({ lat: c.latitude, lng: c.longitude });

  // Track edges (when surveyed) for context.
  if (track.boundary) {
    doc.setDrawColor(200);
    doc.setLineWidth(0.3);
    for (const side of [track.boundary.left, track.boundary.right])
      for (let i = 1; i < side.length; i++) doc.line(...C(side[i - 1]!), ...C(side[i]!));
  }

  // Lap line, each segment coloured by its speed.
  doc.setLineWidth(1.1);
  doc.setLineCap("round");
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i]!.v ?? pts[i - 1]!.v;
    if (v != null && range) doc.setDrawColor(...speedColor(v, range));
    else doc.setDrawColor(150);
    doc.line(...P(pts[i - 1]!), ...P(pts[i]!));
  }

  // Start/finish + sector lines.
  doc.setDrawColor(0);
  doc.setLineWidth(0.8);
  doc.line(...C(track.startFinishLine.pointA), ...C(track.startFinishLine.pointB));
  doc.setDrawColor(120);
  doc.setLineWidth(0.5);
  for (const sec of track.sectors) if (sec.endLine) doc.line(...C(sec.endLine.pointA), ...C(sec.endLine.pointB));

  const [sx, sy] = P(pts[0]!);
  doc.setFillColor(0, 0, 0);
  doc.circle(sx, sy, 1.1, "F");
}

function drawLegend(doc: JsPDF, range: SpeedRange, x: number, y: number) {
  const w = 50;
  const steps = 25;
  for (let i = 0; i < steps; i++) {
    doc.setFillColor(...speedColor(range.lo + ((range.hi - range.lo) * (i + 0.5)) / steps, range));
    doc.rect(x + (i * w) / steps, y, w / steps + 0.1, 2.2, "F");
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(110);
  doc.text(`${range.lo} km/h slow`, x, y + 5.5);
  doc.text(`fast ${range.hi} km/h`, x + w, y + 5.5, { align: "right" });
  doc.text("black line = start/finish  ·  dot = lap start", x + w + 5, y + 2);
}

function drawSpeedTrace(doc: JsPDF, pts: Pt[], range: SpeedRange | null, box: Box) {
  const maxD = Math.max(pts[pts.length - 1]?.d ?? 0, 1);
  const vTop = Math.ceil(Math.max(50, ...pts.map((p) => p.v ?? 0)) / 50) * 50;
  const pl = 10;
  const pb = 6;
  const X = (d: number) => box.x + pl + (d / maxD) * (box.w - pl);
  const Y = (v: number) => box.y + (1 - v / vTop) * (box.h - pb);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.setLineWidth(0.15);
  for (let v = 0; v <= vTop; v += 50) {
    doc.setDrawColor(225);
    doc.line(box.x + pl, Y(v), box.x + box.w, Y(v));
    doc.text(String(v), box.x + pl - 2, Y(v) + 1, { align: "right" });
  }
  doc.text("0 m", box.x + pl, box.y + box.h);
  doc.text(`${Math.round(maxD)} m`, box.x + box.w, box.y + box.h, { align: "right" });

  doc.setLineWidth(0.6);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.v == null || b.v == null) continue;
    if (range) doc.setDrawColor(...speedColor((a.v + b.v) / 2, range));
    else doc.setDrawColor(60);
    doc.line(X(a.d), Y(a.v), X(b.d), Y(b.v));
  }
}
