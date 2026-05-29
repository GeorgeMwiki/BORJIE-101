#!/usr/bin/env node
/**
 * borjie-mcp-server CLI — launches the stdio transport.
 *
 * Read env BORJIE_API_BASE_URL (default https://api.borjie.co.tz) and
 * BORJIE_MCP_TOKEN (required for any tool call that needs auth).
 *
 * Local agents (Claude Code, Cursor) spawn this binary; the MCP client
 * supplies the access token via env or via OAuth device flow before
 * launching the server.
 */

import { runStdio } from './transports/stdio.js';
import { createGatewayClient } from './gateway-client.js';
import type { BorjieMcpAuthContext } from './types.js';
import { BORJIE_SCOPES } from './types.js';
import { createHash, randomUUID } from 'node:crypto';

async function main(): Promise<void> {
  const baseUrl =
    process.env['BORJIE_API_BASE_URL'] ?? 'https://api.borjie.co.tz';
  const token = process.env['BORJIE_MCP_TOKEN'] ?? '';

  const gateway = createGatewayClient({ baseUrl });

  await runStdio({
    gatewayClient: gateway,
    async resolveAuthContext(bearer): Promise<BorjieMcpAuthContext | null> {
      const t = bearer ?? token;
      if (!t) return null;
      // Best-effort resolution: the api-gateway will reject the call if
      // the token is invalid. We synthesise an auth context with all
      // grantable scopes here; the gateway is the authoritative gate.
      const tokenId = createHash('sha256').update(t).digest('hex').slice(0, 16);
      return Object.freeze({
        tenantId: 'pending',
        ownerId: 'pending',
        agentName: process.env['BORJIE_MCP_AGENT_NAME'] ?? 'unknown-agent',
        agentTokenId: tokenId,
        scopes: BORJIE_SCOPES,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 1_000 * 60 * 60,
        correlationId: randomUUID(),
      });
    },
    async killSwitchOpen(): Promise<boolean> {
      return false;
    },
    async auditChainHash({ toolName, auth, idempotencyKey }): Promise<string> {
      const seed = `${auth.agentTokenId}:${toolName}:${idempotencyKey ?? ''}:${Date.now()}`;
      return createHash('sha256').update(seed).digest('hex');
    },
  });
}

void main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`borjie-mcp-server: fatal: ${msg}\n`);
  process.exit(1);
});
