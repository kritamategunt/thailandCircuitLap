/**
 * Local stdio MCP server — same tools as /api/mcp, talking to Supabase directly.
 * Use with Claude Desktop / Claude Code when you don't want a remote endpoint:
 *
 *   npm run mcp     (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env)
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, TRACK_ENGINEER_INSTRUCTIONS, registerTrackEngineerTools } from "../lib/mcp/tools";

async function main() {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: TRACK_ENGINEER_INSTRUCTIONS },
  );
  registerTrackEngineerTools(server);
  await server.connect(new StdioServerTransport());
  console.error(`${MCP_SERVER_NAME} running on stdio`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
