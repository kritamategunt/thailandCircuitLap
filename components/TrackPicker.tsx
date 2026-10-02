"use client";
import type { TrackDefinition } from "@/lib/types";
import { TRACK_LIST } from "@/tracks";

export function TrackPicker({ value, onChange, tracks = TRACK_LIST }: { value: string; onChange: (id: string) => void; tracks?: TrackDefinition[] }) {
  return (
    <div className={`grid gap-2 ${tracks.length === 4 ? "grid-cols-2" : "grid-cols-3"}`} role="radiogroup" aria-label="Track">
      {tracks.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={t.id === value}
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-2 py-2 text-xs leading-tight font-bold ${t.id === value ? "bg-flag text-black" : "bg-line text-ink"}`}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
