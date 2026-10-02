# Thailand Circuit AI Track Engineer

Phone-GPS lap timer for **Thailand Circuit (Nakhon Chai Si)** with automatic lap/sector detection, map
visualization, lap comparison, and an **MCP server** so an AI can act as your track engineer.

> Experimental. Phone GPS (~1 Hz, ±3–10 m) is not motorsport telemetry. The app labels estimates and avoids false precision.

## Quick start (local)

```bash
npm install
cp .env.example .env.local     # fill in Supabase + MCP_API_KEY
npm run dev                    # http://localhost:3000
npm test                       # unit tests
npm run typecheck && npm run build
```

Geolocation needs HTTPS on phones. For on-phone testing of a local build use a tunnel (e.g. `npx localtunnel --port 3000`) or just deploy to Vercel.

## Deploy (≈10 minutes)

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste `supabase/migrations/0001_init.sql` → Run.
3. **Project Settings → API**: copy `Project URL`, `anon` key, `service_role` key.

### 2. Vercel
1. Push this repo to GitHub → **vercel.com → Add New → Project** → import.
2. Environment variables (Production + Preview):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**server only — never prefix with NEXT_PUBLIC_**) |
   | `MCP_API_KEY` | `openssl rand -hex 32` |
   | `NEXT_PUBLIC_TERRAIN_TILES_URL` | optional raster-dem tiles for real 3D terrain |

3. Deploy. Open `https://<your-app>.vercel.app` on your phone.

Or with CLI: `npx vercel link && npx vercel env add … && npx vercel --prod`.

### 3. MCP (no extra infra — it ships inside the Vercel app)

Remote (Streamable HTTP): `https://<your-app>.vercel.app/api/mcp`, header `Authorization: Bearer <MCP_API_KEY>`.

Claude Code:
```bash
claude mcp add --transport http thailand-circuit https://<your-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_API_KEY>"
```

Claude Desktop / stdio-only clients (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "thailand-circuit": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-app>.vercel.app/api/mcp",
               "--header", "Authorization: Bearer <MCP_API_KEY>"]
    }
  }
}
```

Local stdio (talks to Supabase directly):
```json
{
  "mcpServers": {
    "thailand-circuit": {
      "command": "npx", "args": ["tsx", "/path/to/repo/mcp/stdio.ts"],
      "env": { "NEXT_PUBLIC_SUPABASE_URL": "…", "SUPABASE_SERVICE_ROLE_KEY": "…" }
    }
  }
}
```

Then ask: *“List my sessions and debrief my latest best lap vs lap 3.”*

## ⚠️ Calibrate the track before your first real session

`tracks/thailand-circuit.ts` ships with **placeholder geometry** (we don’t invent GPS data). Until calibrated, the app records but detects no laps.

1. Record one slow lap (any session).
2. Open `/track?calibrate=1&session=<id>` → satellite view with your trajectory.
3. Tap Start/Finish A & B across the full track width, then Sector 1 and 2 end-lines, then each corner apex.
4. Copy the generated snippet into `tracks/thailand-circuit.ts`, set `verified: true`, commit → Vercel redeploys.
5. On the Laps page press **Re-time** (or `POST /api/sessions/:id/recompute`) to re-time earlier sessions.

If laps don’t count, set `direction: "any"` first, then pin the direction once verified.

## Using it at the track

1. Open the app → **START SESSION** → **START** → allow location.
2. Keep the screen on (the app requests a wake lock; GPS may pause when the phone locks).
3. No signal? Fine — every fix is stored in IndexedDB and uploaded when the connection returns. FINISH also queues.
4. Afterwards: **Laps** (table, purple = best) → select 2 → **Compare**; tap a lap for analysis; **Map** for the racing line.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/sessions` | `{trackId, name?}` → `{session, writeToken}` |
| POST | `/api/sessions/:id/gps` | `{points: GPSPoint[≤500]}`, header `x-session-token` |
| POST | `/api/sessions/:id/finish` | header `x-session-token` |
| POST | `/api/sessions/:id/recompute` | token or `Bearer MCP_API_KEY` |
| GET | `/api/sessions` | list all — `Bearer MCP_API_KEY` |
| GET | `/api/sessions/:id` · `/laps` · `/trajectory` | |
| GET | `/api/laps/:id[?points=1]` | |
| GET | `/api/laps/:id/compare?with=<lapId>` | deltas = with − id |
| GET | `/api/laps/:id/analysis[?corner=T1]` | |
| GET | `/api/tracks/:id` | |

Session reads use the UUID as a capability URL (unguessable); writes need the per-session token kept on the phone.

## Project layout

See `skill.md` §4. Core engine: `lib/telemetry/` (pure, tested). Track config: `tracks/`.

## Verified in this build

- 38 unit tests (`npm test`), strict typecheck, production build.
- End-to-end against Postgres + PostgREST: session → 1,464 points uploaded in batches (+ idempotent retry) →
  finish → 3 timed laps with sectors → compare / analysis / corner estimates → recompute keeps lap IDs → MCP
  `list_sessions`, `analyze_lap`, `compare_laps`, error handling.
- Not yet verified: on-phone GPS at the circuit (requires calibration + a real ride).
