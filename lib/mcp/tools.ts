import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  analyzeLapById,
  compareLapsById,
  getCornerData,
  getLapDetail,
  getSessionDetail,
  getTrackInfo,
  listSessions,
  ServiceError,
} from "@/lib/server/service";

export const MCP_SERVER_NAME = "thailand-circuit-mcp";
export const MCP_SERVER_VERSION = "0.1.0";

/** Sent to every MCP client: how the "AI Track Engineer" must behave. */
export const TRACK_ENGINEER_INSTRUCTIONS = `You are the AI Track Engineer for riders at Thailand Circuit (Nakhon Chai Si).
Data comes from a PHONE GPS (~1 Hz, ±3–10 m). It is not motorsport telemetry.

Rules:
1. Always separate: MEASURED (device data), CALCULATED (deterministic maths), ESTIMATED (inferred, has a range+confidence), and your INTERPRETATION.
2. Never state estimates as facts. Say "GPS data suggests the minimum speed at T7 was approximately 94 km/h", never "you braked 42 m before T7".
3. Braking/acceleration zones are ranges (e.g. "approximately 40–50 m before the apex, confidence low"). Never quote metre-level precision.
4. Lap/sector deltas under ~0.1 s per segment, or any data with quality "poor", are within noise — say so.
5. Do not invent rider technique (body position, throttle, gear) that GPS cannot show.
6. If track.metadata.verified is false, warn that lap/sector/corner geometry is uncalibrated.

Workflow: list_sessions -> get_session -> analyze_lap (vs best) -> compare_laps / get_corner_data for detail.
Report format: lap time, deltas vs best by sector, where time was gained/lost (lap-distance %), data quality, 1–3 suggested focus points phrased as things to compare/test.`;

const uuid = z.uuid();

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function err(e: unknown) {
  const msg = e instanceof ServiceError ? e.message : e instanceof Error ? e.message : "Unknown error";
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

async function run(fn: () => Promise<unknown> | unknown) {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e);
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

/** Register all tools/prompts. Shared by the HTTP route (/api/mcp) and the stdio entrypoint. */
export function registerTrackEngineerTools(server: McpServer) {
  server.registerTool(
    "get_track",
    {
      title: "Get track",
      description: "Track definition: name, start/finish line, sectors, corners, metadata (incl. whether geometry is verified).",
      inputSchema: z.object({ trackId: z.string().regex(/^[a-z0-9-]{1,64}$/).default("thailand-circuit") }),
      annotations: readOnly,
    },
    async ({ trackId }) => run(() => getTrackInfo(trackId)),
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description: "Most recent riding sessions with summary (best lap, timed laps, consistency).",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      annotations: readOnly,
    },
    async ({ limit }) => run(() => listSessions(limit)),
  );

  server.registerTool(
    "get_session",
    {
      title: "Get session",
      description: "Session metadata, all laps (out/timed/in) with metrics, and session summary (best lap, theoretical best, best sectors).",
      inputSchema: z.object({ sessionId: uuid }),
      annotations: readOnly,
    },
    async ({ sessionId }) => run(() => getSessionDetail(sessionId)),
  );

  server.registerTool(
    "get_lap",
    {
      title: "Get lap",
      description: "Lap metrics, sector times, GPS quality summary and speed statistics. Set includeTrace for the full speed/position trace.",
      inputSchema: z.object({ lapId: uuid, includeTrace: z.boolean().default(false) }),
      annotations: readOnly,
    },
    async ({ lapId, includeTrace }) => run(() => getLapDetail(lapId, { includePoints: includeTrace })),
  );

  server.registerTool(
    "compare_laps",
    {
      title: "Compare laps",
      description:
        "Compare lap B against lap A (deltas = B minus A; negative time = B faster): lap/sector/max-speed/distance deltas, 20 distance-normalized segments with time deltas, biggest gains/losses, per-corner speed deltas.",
      inputSchema: z.object({ lapA: uuid, lapB: uuid }),
      annotations: readOnly,
    },
    async ({ lapA, lapB }) => run(() => compareLapsById(lapA, lapB)),
  );

  server.registerTool(
    "get_corner_data",
    {
      title: "Get corner data",
      description:
        "Entry / minimum / exit speed, time through corner, and ESTIMATED braking zone + acceleration point (ranges with confidence) for one corner of one lap.",
      inputSchema: z.object({ lapId: uuid, cornerId: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/) }),
      annotations: readOnly,
    },
    async ({ lapId, cornerId }) => run(() => getCornerData(lapId, cornerId)),
  );

  server.registerTool(
    "analyze_lap",
    {
      title: "Analyze lap",
      description:
        "Structured analysis for the AI Track Engineer: lap time, delta to best and theoretical best, strong/weak sectors, potential time loss, comparison vs best lap, corner data, data quality, provenance labels and caveats.",
      inputSchema: z.object({ lapId: uuid }),
      annotations: readOnly,
    },
    async ({ lapId }) => run(() => analyzeLapById(lapId)),
  );

  server.registerPrompt(
    "lap_debrief",
    {
      title: "Lap debrief",
      description: "Ask the AI Track Engineer to debrief one lap against the session best.",
      argsSchema: z.object({ lapId: z.string() }),
    },
    ({ lapId }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Debrief lap ${lapId}. Call analyze_lap, then compare_laps against the session best if useful. Follow the Track Engineer rules: label measured / calculated / estimated, give ranges not false precision, and flag data quality.`,
          },
        },
      ],
    }),
  );
}
