/**
 * Hono HTTP transport for mcp-server-tra.
 *
 * Exposes a thin REST-shaped surface so non-MCP callers (curl, k6,
 * integration tests, the api-gateway when MCP is unset) can list
 * tools and dispatch calls without speaking the MCP protocol.
 *
 * Endpoints:
 *   GET  /healthz                  -> liveness
 *   GET  /tools                    -> tool catalogue
 *   POST /tools/:name              -> dispatch a tool with JSON body
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { TRA_TOOLS, findTraTool } from './tools/index.js';
import { logger } from './logger.js';

const dispatchBodySchema = z.unknown();

export function createTraHttpApp(): Hono {
  const app = new Hono();

  app.get('/healthz', (c) =>
    c.json({ ok: true, service: 'mcp-server-tra', tools: TRA_TOOLS.length }),
  );

  app.get('/tools', (c) =>
    c.json({
      tools: TRA_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
      })),
    }),
  );

  app.post('/tools/:name', async (c) => {
    const name = c.req.param('name');
    const tool = findTraTool(name);
    if (!tool) {
      return c.json(
        {
          error: 'unknown_tool',
          message: `Unknown TRA tool: ${name}`,
          known: TRA_TOOLS.map((t) => t.name),
        },
        404,
      );
    }
    const rawBody = await c.req.json().catch(() => null);
    const bodyParse = dispatchBodySchema.safeParse(rawBody);
    if (!bodyParse.success) {
      return c.json(
        { error: 'invalid_body', message: 'request body must be JSON' },
        400,
      );
    }
    const inputParse = tool.zodInput.safeParse(rawBody);
    if (!inputParse.success) {
      return c.json(
        {
          error: 'validation_failed',
          message: 'input did not match tool schema',
          issues: inputParse.error.issues,
        },
        400,
      );
    }
    try {
      const result = await tool.execute(inputParse.data as never);
      return c.json({ ok: true, tool: name, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.error('tool execution failed', { tool: name, message });
      return c.json(
        { error: 'tool_failed', tool: name, message },
        500,
      );
    }
  });

  return app;
}
