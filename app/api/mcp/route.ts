import { createMcpHandler } from "mcp-handler";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  TRACK_ENGINEER_INSTRUCTIONS,
  registerTrackEngineerTools,
} from "@/lib/mcp/tools";
import { apiKeyMatches } from "@/lib/server/security";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless) — runs on Vercel with the web app,
 * so no extra MCP infrastructure is needed.  URL: https://<app>/api/mcp
 * Auth: Authorization: Bearer <MCP_API_KEY>
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const mcp = createMcpHandler((server) => registerTrackEngineerTools(server), {
  serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
  instructions: TRACK_ENGINEER_INSTRUCTIONS,
});

async function handler(req: Request): Promise<Response> {
  if (!apiKeyMatches(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="thailand-circuit-mcp"' },
    });
  }
  return mcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
