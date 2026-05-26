/**
 * @borjie/mcp-server-tra — entrypoint.
 *
 * Tanzania Revenue Authority MCP server. Exposes 5 tools:
 *   - tra.lookup_tin
 *   - tra.compute_royalty       (real computation)
 *   - tra.compute_corporate_tax (real computation)
 *   - tra.submit_vat_return     (stub ref number)
 *   - tra.fetch_outstanding     (stub balance breakdown)
 *
 * Two transports are bound at startup:
 *   - Hono HTTP server on $PORT (default 3110) — `/healthz`, `/tools`,
 *     `POST /tools/:name`. Used by the api-gateway fallback path and
 *     by any non-MCP integration test.
 *   - MCP stdio server — used when the binary is launched by an MCP
 *     client. The stdio transport is only attached when env
 *     `MCP_TRA_STDIO=1` so HTTP-only deployments stay quiet.
 */
import { serve } from '@hono/node-server';
import { createTraHttpApp } from './http.js';
import { createTraMcpServer, type McpServerHandle } from './mcp.js';
import { logger } from './logger.js';

export const DEFAULT_PORT = 3110;

export {
  TRA_TOOLS,
  TRA_TOOL_NAMES,
  findTraTool,
  lookupTinTool,
  computeRoyaltyTool,
  computeCorporateTaxTool,
  submitVatReturnTool,
  fetchOutstandingTool,
} from './tools/index.js';
export type { AnyTraTool, TraTool } from './types.js';
export { createTraHttpApp } from './http.js';
export { createTraMcpServer } from './mcp.js';

interface BootstrapResult {
  readonly httpClose: () => Promise<void>;
  readonly mcp: McpServerHandle | null;
}

async function bootstrap(port: number): Promise<BootstrapResult> {
  const app = createTraHttpApp();
  const httpServer = serve({ fetch: app.fetch, port });
  logger.info('mcp-server-tra http listening', { port });

  let mcp: McpServerHandle | null = null;
  if (process.env.MCP_TRA_STDIO === '1') {
    try {
      mcp = await createTraMcpServer();
      await mcp.connect();
      logger.info('mcp-server-tra mcp/stdio listening');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.warn('mcp-server-tra mcp/stdio bootstrap failed', { message });
    }
  }

  const httpClose = (): Promise<void> =>
    new Promise((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

  return Object.freeze({ httpClose, mcp });
}

const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false;
    const argvUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === argvUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  bootstrap(Number.isFinite(port) ? port : DEFAULT_PORT)
    .then(({ httpClose, mcp }) => {
      const shutdown = async (): Promise<void> => {
        try {
          if (mcp) await mcp.close();
          await httpClose();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          logger.error('shutdown error', { message });
        } finally {
          process.exit(0);
        }
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => {
      logger.error('mcp-server-tra fatal bootstrap error', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
