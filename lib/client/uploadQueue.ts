"use client";
import { MAX_POINTS_PER_BATCH } from "@/lib/validation";
import { countPending, getPending, getSessionMeta, markUploaded, saveSessionMeta } from "./localStore";
import { api } from "./api";

export type QueueStatus = { pending: number; online: boolean; lastError: string | null; lastUploadAt: number | null };

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Upload queue: IndexedDB -> POST /api/sessions/:id/gps in batches.
 * Points are marked uploaded only after the server confirms (the server upsert is idempotent,
 * so a retry after a lost response is harmless). Exponential backoff while offline.
 */
export class UploadQueue {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private running = false;
  private backoff = FLUSH_INTERVAL_MS;
  private status: QueueStatus = { pending: 0, online: true, lastError: null, lastUploadAt: null };
  private readonly onOnline = () => {
    this.backoff = FLUSH_INTERVAL_MS;
    void this.flush();
  };

  constructor(private readonly sessionId: string, private readonly onStatus: (s: QueueStatus) => void) {}

  start() {
    this.running = true;
    window.addEventListener("online", this.onOnline);
    this.schedule(0);
  }

  stop() {
    this.running = false;
    window.removeEventListener("online", this.onOnline);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Drain everything pending. Returns true when the queue is empty. */
  async flush(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    let empty = false;
    try {
      const meta = await getSessionMeta(this.sessionId);
      if (!meta) return true;
      for (;;) {
        const batch = await getPending(this.sessionId, MAX_POINTS_PER_BATCH);
        if (batch.length === 0) break;
        await api.uploadPoints(
          this.sessionId,
          meta.writeToken,
          batch.map(({ sessionId: _s, uploaded: _u, ...p }) => p),
        );
        await markUploaded(batch);
        this.status.lastUploadAt = Date.now();
      }
      if (meta.finishPending) {
        await api.finish(this.sessionId, meta.writeToken);
        await saveSessionMeta({ ...meta, finishPending: false, status: "completed" });
      }
      this.status.online = true;
      this.status.lastError = null;
      this.backoff = FLUSH_INTERVAL_MS;
      empty = true;
    } catch (e) {
      this.status.online = typeof navigator === "undefined" ? false : navigator.onLine;
      this.status.lastError = e instanceof Error ? e.message : String(e);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    } finally {
      this.busy = false;
      this.status.pending = await countPending(this.sessionId).catch(() => this.status.pending);
      this.onStatus({ ...this.status });
      if (this.running) this.schedule(empty ? FLUSH_INTERVAL_MS : this.backoff);
    }
    return empty;
  }
}
