# skill.md — Thailand Circuit AI Track Engineer

Instruction/spec for an AI coding agent that owns this project end-to-end (build → test → deploy → extend).
Read this whole file before changing code. When in doubt: **simple + reliable first, document the extension point.**

---

## 1. Mission

Phone-GPS lap timer for **Thailand Circuit, Nakhon Chai Si (TH)** that:

1. Records GPS from the phone browser (`navigator.geolocation.watchPosition`).
2. Detects laps by **start/finish line crossing** and sector splits.
3. Shows live lap timing on the phone; stores sessions/laps in Supabase.
4. Exposes data via **MCP** (`thailand-circuit-mcp`) so an LLM acts as an **AI Track Engineer**.
5. Deploys in minutes: **Vercel** (web + API + MCP) + **Supabase** (Postgres).

Non-goals for MVP: Kubernetes, Redis, Kafka, microservices, user accounts, custom 3D terrain.

## 2. Stack (fixed unless there is a strong reason)

| Concern | Choice |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 |
| Map | MapLibre GL JS (raster satellite/OSM, optional raster-dem terrain) |
| DB | Supabase Postgres, accessed **only** server-side with the service-role key |
| API | Next.js Route Handlers (`app/api/**`) |
| MCP | `@modelcontextprotocol/server` v2 + `mcp-handler` v2 (stateless Streamable HTTP at `/api/mcp`) + stdio entry (`mcp/stdio.ts`) |
| Tests | Vitest (pure telemetry engine) |
| Validation | zod v4 |

## 3. Architecture

```
Phone browser
  GpsTracker (watchPosition, device timestamps)
     ├─> IndexedDB local buffer  ──> UploadQueue (batched, retry/backoff) ──> POST /api/sessions/:id/gps
     └─> LiveLapTimer (pure)     ──> Live UI (/session/[id])

Next.js API (Vercel)
  routes ─> lib/server/service.ts ─> lib/server/repo.ts ─> Supabase
                    └─> lib/telemetry/* (pure engine; server recompute = source of truth)
  /api/mcp ─> lib/mcp/tools.ts (same services)

AI client (Claude etc.) ──MCP──> /api/mcp  (Bearer MCP_API_KEY)
```

Rules:
- **All maths lives in `lib/telemetry/`** — pure functions, no React, no I/O. UI and server both call it.
- **Server recompute is authoritative.** Laps are derived data, recomputed from all stored points
  (on finish, on late uploads, throttled every 30 s while live, or via `/recompute`). Upsert by
  `(session_id, lap_number)` keeps lap IDs stable.
- **Live timer mirrors server logic** (`LiveLapTimer`) — a test asserts identical lap times.
- **Track geometry has one source of truth:** `tracks/thailand-circuit.ts`. Never hard-code coordinates elsewhere.

## 4. Directory map

```
app/                      pages + API routes
  page.tsx                Dashboard (START SESSION, my sessions)
  session/[id]            Live session (rider screen)
  track                   Track view + calibration tool (?calibrate=1&session=)
  laps, laps/[id]         Lap history table, lap analysis
  compare                 Lap comparison (?a=&b=)
  api/…                   REST + /api/mcp
components/               UI (TrackMap, SpeedTrace, LiveSession, …) — no business logic
hooks/useLiveSession.ts   wires tracker → buffer → queue → timer
lib/types.ts              domain types (GPSPoint, TrackDefinition, LapMetrics, …)
lib/telemetry/            engine: distance, quality, lineCrossing, lapDetection, sectorDetection,
                          speed, metrics, session, corners, compare, analysis, liveTimer, config
lib/client/               browser: gpsTracker, localStore (IndexedDB), uploadQueue, api
lib/server/               supabase client, repo (data access), service (use cases), security, http
lib/mcp/tools.ts          MCP tool definitions + Track Engineer instructions
mcp/stdio.ts              local stdio MCP server
tracks/                   track configs (source of truth)
supabase/migrations/      SQL schema
tests/                    Vitest
```

## 5. GPS handling (must hold)

- Timestamp = `position.timestamp` (device fix time). Never assume a fixed rate.
- `sanitizePoints`: drop invalid coords; sort out-of-order; dedupe equal timestamps (keep best accuracy);
  **flag** (don't drop) accuracy > `MAX_GPS_ACCURACY_METERS` (30); drop single **GPS jumps**
  (implied speed > 380 km/h; accept with a trajectory break after 3 consecutive); mark gaps > 5 s as breaks.
- Never time or measure across a trajectory break.
- `speed = null` → derive from neighbours (central difference), label as derived.
- Permission denied / unavailable / signal lost → explicit UI states. Wake Lock while recording; warn when tab hidden.

## 6. Lap & sector detection

- Line crossing = 2D segment intersection in a local metric projection; timing lines extended by
  `lineToleranceMeters`. Crossing time/speed **interpolated** along the segment.
- `direction` (`left-to-right` | `right-to-left` | `any`) relative to vector A→B.
- Reject crossings within `max(MIN_LAP_TIME_SECONDS, CROSSING_COOLDOWN_SECONDS)` of the last accepted one.
- Lap 1 = session start → first crossing (`out`, untimed). Then `timed` laps. Tail = `in` (untimed).
- Sectors are defined by **end lines**; last sector ends at S/F. Missing boundary → `null` (never guessed).
- Zero-length (placeholder) S/F line → no laps (by design until calibrated).

## 7. Track definition & calibration

`tracks/thailand-circuit.ts` currently has **placeholder geometry** (only centre 13.9118444 N 100.1678694 E,
2.5 km, 15 turns come from public sources). **Do not invent coordinates.** Calibrate:
1. Record a slow lap, open `/track?calibrate=1&session=<id>` (satellite view).
2. Tap S/F A,B → S1 end A,B → S2 end A,B → corner apexes. Copy generated snippet into the file, `verified: true`.
3. Redeploy; re-time old sessions (Laps page “Re-time” or `POST /api/sessions/:id/recompute`).

## 8. Data model (Supabase)

`tracks` (FK anchor), `sessions` (status, write_token_hash, summary jsonb), `laps` (unique session_id+lap_number,
metrics jsonb), `lap_sectors`, `gps_points` (unique session_id+ts → idempotent uploads; optional lap_id; `source`
column for future sensors). RLS enabled with **no policies** → anon key has zero access.
`track_sectors`/`track_corners` tables are deliberately deferred (geometry is code-versioned).

## 9. API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/sessions` → `{session, writeToken}` | rate-limited |
| GET | `/api/sessions` (list all) | Bearer MCP_API_KEY |
| POST | `/api/sessions/:id/gps` `{points:[≤500]}` | `x-session-token` |
| POST | `/api/sessions/:id/finish` | `x-session-token` |
| POST | `/api/sessions/:id/recompute` | token or Bearer |
| GET | `/api/sessions/:id`, `/laps`, `/trajectory` | capability URL (UUID) |
| GET | `/api/laps/:id[?points=1]`, `/compare?with=`, `/analysis[?corner=]` | capability URL |
| GET | `/api/tracks/:id` | public |

Security: zod validation (lat ±90, lng ±180, sane speed/accuracy/timestamps), 256 KB body cap, UUID-sanitized IDs,
per-session upload rate limit (best-effort in-memory), hashed write tokens, timing-safe compares, service key server-only.

## 10. MCP — `thailand-circuit-mcp`

Endpoint `https://<app>/api/mcp` (Bearer `MCP_API_KEY`) or stdio `npm run mcp`.
Tools: `get_track`, `list_sessions`, `get_session`, `get_lap`, `compare_laps` (B−A), `get_corner_data`,
`analyze_lap`; prompt `lap_debrief`. Every tool returns JSON text + `structuredContent`.

### AI Track Engineer contract (enforced via server `instructions`)
- Label everything: **measured / calculated / estimated / interpretation**.
- Estimates are **ranges with confidence**, rounded (speeds to 1 km/h, distances to 5 m). No false precision.
- GOOD: “GPS data suggests minimum speed at T7 was approximately 94 km/h.”
  BAD: “You braked 42 m before T7.”
- Flag poor GPS quality and sub-0.1 s segment deltas as noise; warn when track is unverified.
- Never infer technique GPS can’t show (body position, gear, throttle).

## 11. Testing

`npm test` — 38 unit tests: distance, `hasCrossedLine`, `detectLaps`/`detectLap`, `detectSector`,
`calculateLapMetrics`, corners, compare, live timer parity. Edge cases covered: GPS jump, backwards crossing,
duplicate/jitter crossing, poor accuracy, missing speed, missing altitude, irregular intervals, placeholder track.
Add a test for every engine change. `npm run typecheck` and `npm run build` must pass.

## 12. Deployment (summary — details in README)

1. Supabase project → run `supabase/migrations/0001_init.sql`.
2. Vercel import repo → env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_API_KEY`.
3. Deploy → open on phone over HTTPS (Geolocation requires a secure context).
4. Connect MCP client to `https://<app>/api/mcp` with the bearer key.

## 13. Development phases (status)

1. Core (Next, Tailwind, Supabase, GPS logger, sessions, storage) — **done**
2. Track engine (config, S/F, laps, sectors, metrics) — **done** (geometry needs on-site calibration)
3. Visualization (MapLibre, trajectory, lap lines, 2D/3D) — **done**
4. Analysis (history, comparison, sectors) — **done**
5. MCP (server, tools, structured responses) — **done**
6. Deployment (Vercel + Supabase + MCP on same deployment) — **documented**

## 14. Extension points (do not build until needed)

- **External GPS 10/20/50 Hz**: feed the same `GPSPoint` shape with `source='external-gps'`; engine is rate-agnostic.
- **IMU / OBD / CAN** (lean, accel, RPM, throttle, gear, brake pressure): `TelemetryChannelSample`
  (timestamp, source, channel, value) on the shared ms time base → new table `telemetry_samples`.
  With brake/throttle channels, `analyzeCorner` can switch braking zone from *estimated* to *measured*.
- **Video sync**: store per-session offset `video_offset_ms` (GoPro time − GPS time); align on S/F crossings.
- **Runtime-editable tracks**: add `track_sectors`/`track_corners` tables, load into `TrackDefinition`.
- **Auth**: Supabase Auth + RLS policies per owner; replace capability-URL reads.
- **Rate limiting**: swap in-memory limiter for Upstash/Vercel KV.

## 15. Definition of Done

Phone opens deployed URL → grants GPS → START → points buffer through network loss → crossing S/F
detects a lap with time → laps stored in Supabase → trajectory on map → laps compared → MCP retrieves and
analyzes laps → deployable from README steps. **Only remaining real-world step: calibrate track geometry on site.**
