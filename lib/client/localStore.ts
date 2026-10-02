"use client";
import type { GPSPoint } from "@/lib/types";

/**
 * Local buffer (IndexedDB). Every GPS fix is written here FIRST; the upload queue drains it.
 * A failing network can never lose an active session: points stay until the server confirms.
 *
 *   points:   key [sessionId, timestamp]  (dedupes repeated fixes)  uploaded: 0 | 1
 *   sessions: key id  — local session metadata incl. the private write token
 */
const DB_NAME = "tc-track-engineer";
const DB_VERSION = 1;

export type StoredPoint = GPSPoint & { sessionId: string; uploaded: 0 | 1 };

export type LocalSessionMeta = {
  id: string;
  trackId: string;
  name?: string | null;
  writeToken: string;
  startedAt: string;
  status: "active" | "completed";
  /** FINISH pressed while offline — the queue sends it once all points are uploaded. */
  finishPending?: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const pts = db.createObjectStore("points", { keyPath: ["sessionId", "timestamp"] });
      pts.createIndex("bySessionUploaded", ["sessionId", "uploaded"]);
      pts.createIndex("bySession", "sessionId");
      db.createObjectStore("sessions", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function savePoint(sessionId: string, p: GPSPoint): Promise<void> {
  await tx("points", "readwrite", (s) => s.put({ ...p, sessionId, uploaded: 0 } satisfies StoredPoint));
}

export async function getSessionPoints(sessionId: string): Promise<StoredPoint[]> {
  const rows = (await tx<StoredPoint[]>("points", "readonly", (s) => s.index("bySession").getAll(sessionId))) ?? [];
  return rows.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getPending(sessionId: string, limit: number): Promise<StoredPoint[]> {
  return (await tx<StoredPoint[]>("points", "readonly", (s) => s.index("bySessionUploaded").getAll([sessionId, 0], limit))) ?? [];
}

export async function countPending(sessionId: string): Promise<number> {
  return (await tx<number>("points", "readonly", (s) => s.index("bySessionUploaded").count([sessionId, 0]))) ?? 0;
}

export async function markUploaded(points: StoredPoint[]): Promise<void> {
  await tx("points", "readwrite", (s) => {
    for (const p of points) s.put({ ...p, uploaded: 1 });
  });
}

export async function saveSessionMeta(meta: LocalSessionMeta): Promise<void> {
  await tx("sessions", "readwrite", (s) => s.put(meta));
}

export async function getSessionMeta(id: string): Promise<LocalSessionMeta | undefined> {
  return tx<LocalSessionMeta>("sessions", "readonly", (s) => s.get(id));
}

export async function listSessionMetas(): Promise<LocalSessionMeta[]> {
  const all = (await tx<LocalSessionMeta[]>("sessions", "readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Sessions with points still waiting for upload (used to resume draining after reload). */
export async function sessionsWithPending(): Promise<string[]> {
  const metas = await listSessionMetas();
  const out: string[] = [];
  for (const m of metas) if ((await countPending(m.id)) > 0 || m.finishPending) out.push(m.id);
  return out;
}
