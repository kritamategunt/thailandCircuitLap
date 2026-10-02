"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_TRACK_ID, getTrack } from "@/tracks";
import { api } from "@/lib/client/api";
import { listSessionMetas, saveSessionMeta, type LocalSessionMeta } from "@/lib/client/localStore";
import { Empty, Panel, UncalibratedBanner } from "@/components/ui";

export default function Dashboard() {
  const router = useRouter();
  const track = getTrack(DEFAULT_TRACK_ID)!;
  const [sessions, setSessions] = useState<LocalSessionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    listSessionMetas().then(setSessions).catch(() => setSessions([]));
  }, []);

  async function startSession() {
    setBusy(true);
    setError(null);
    try {
      const name = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const { session, writeToken } = await api.createSession(track.id, name);
      await saveSessionMeta({ id: session.id, trackId: session.trackId, name, writeToken, startedAt: session.startedAt, status: "active" });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session (are you online?)");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <p className="text-xs font-bold tracking-[0.3em] text-flag uppercase">AI Track Engineer</p>
        <h1 className="text-3xl font-black tracking-tight">{track.name}</h1>
        <p className="text-sm text-dim">Nakhon Chai Si · {(track.lengthMeters ?? 0) / 1000} km · phone GPS lap timing</p>
      </header>

      {!track.verified && <UncalibratedBanner />}

      <button
        onClick={startSession}
        disabled={busy}
        className="w-full rounded-xl bg-flag py-8 text-2xl font-black tracking-widest text-black uppercase active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? "Creating…" : "Start session"}
      </button>
      {error && <p className="text-sm text-red">{error}</p>}

      <Panel title="My sessions (this device)">
        {sessions.length === 0 ? (
          <Empty>No sessions yet. Start one at the track.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{s.name ?? s.id.slice(0, 8)}</div>
                  <div className="text-xs text-dim">
                    {s.status === "completed" ? "Completed" : s.finishPending ? "Finishing (waiting for network)" : "Active"}
                  </div>
                </div>
                {s.status !== "completed" && (
                  <Link href={`/session/${s.id}`} className="rounded bg-go/15 px-3 py-2 text-xs font-bold text-go uppercase">
                    Live
                  </Link>
                )}
                <Link href={`/laps?session=${s.id}`} className="rounded bg-line px-3 py-2 text-xs font-bold uppercase">
                  Laps
                </Link>
                <Link href={`/track?session=${s.id}`} className="rounded bg-line px-3 py-2 text-xs font-bold uppercase">
                  Map
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Open a shared session">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = openId.trim();
            if (id) router.push(`/laps?session=${encodeURIComponent(id)}`);
          }}
        >
          <input
            value={openId}
            onChange={(e) => setOpenId(e.target.value)}
            placeholder="Session ID"
            className="min-w-0 flex-1 rounded border border-line bg-bg px-3 py-2 text-sm"
          />
          <button className="rounded bg-line px-4 text-xs font-bold uppercase">Open</button>
        </form>
      </Panel>

      <p className="text-xs leading-relaxed text-dim">
        Experimental tool. Phone GPS (~1 Hz, ±3–10 m) is not professional motorsport telemetry — treat small differences as noise.
        Keep the screen on while recording.
      </p>
    </div>
  );
}
