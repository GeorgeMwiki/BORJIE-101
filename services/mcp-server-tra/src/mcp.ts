/**
 * MCP (stdio) transport for mcp-server-tra.
 *
 * Wraps the shared tool registry in `@modelcontextprotocol/sdk`'s
 * `Server` so MCP-aware clients (Claude Desktop, the api-gateway MCP
 * client) can discover and call the 5 TRA tools the same way they
 * call any other MCP server.
 *
 * The SDK is loaded lazily so the package still type-checks and runs
 * the HTTP transport when the SDK is unavailable at runtime.
 */
import type { AnyTraTool } from './types.js';
import { TRA_TOOLS, findTraTool } from './tools/index.js';

export interface McpServerHandle {
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Build an MCP `Server` instance that advertises `TRA_TOOLS` over
 * `tools/list` and dispatches `tools/call` through Zod-validated
 * tool executors. Returns a handle wrapping the SDK objects so the
 * top-level bootstrap can stay SDK-agnostic.
 */
export async function createTraMcpServer(): Promise<McpServerHandle> {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    '@modelcontextprotocol/sdk/types.js'
  );

  const server = new Server(
    { name: 'borjie-mcp-tra', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TRA_TOOLS.map((t: AnyTraTool) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as unknown as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = findTraTool(name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${name}. Known: ${TRA_TOOLS.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    }
    const parsed = tool.zodInput.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `tra: input validation failed: ${parsed.error.issues
              .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
              .join('; ')}`,
          },
        ],
      };
    }
    try {
      const result = await tool.execute(parsed.data as never);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return {
        isError: true,
        content: [{ type: 'text', text: `tra error in ${name}: ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();

  return Object.freeze({
    connect: async () => {
      await server.connect(transport);
    },
    close: async () => {
      await server.close();
    },
  });
}
