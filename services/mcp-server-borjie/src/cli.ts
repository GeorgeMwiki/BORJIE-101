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
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

/**
 * Evaluate the env-based kill-switch for the stdio path. Returns `true`
 * when the kill-switch is ENGAGED (deny the call) and `false` only for an
 * explicit safe state.
 *
 * Mirrors the canonical kernel table (central-intelligence
 * kernel/killswitch.ts `parseLevel`) but as a fail-closed BOOLEAN gate:
 * ONLY an explicit safe value allows — an empty/absent value ('live', no
 * kill-switch configured), a literal 'live', or the alias 'off'. EVERY
 * other value denies: 'halt' (hard refusal), 'degraded' (kernel restricts
 * to lower-stakes only — this gate has no stakes signal, so it denies),
 * and ANY unrecognized/ambiguous/typo'd value (an operator
 * misconfiguration must never silently fabricate full live operation —
 * CLAUDE.md: "Kill-switch fail-closed. Never catch + ignore its errors").
 */
export function evalKillSwitchOpen(
  rawState: string | undefined = process.env['KILLSWITCH_STATE'],
): boolean {
  try {
    const state = (rawState ?? '').trim().toLowerCase();
    // Explicit safe values → kill-switch NOT engaged → allow.
    if (state.length === 0 || state === 'live' || state === 'off') {
      return false;
    }
    // 'halt', 'degraded', or any unrecognized/ambiguous value → deny.
    return true;
  } catch {
    return true;
  }
}

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
      // stdio path has no DB handle. Consult the kernel's env-based
      // killswitch convention (`KILLSWITCH_STATE`) via the fail-closed
      // helper above. The gateway re-checks its DB-backed state on every
      // proxied call, so this is defence-in-depth, not the sole gate.
      return evalKillSwitchOpen();
    },
    async auditChainHash({ toolName, auth, idempotencyKey }): Promise<string> {
      const seed = `${auth.agentTokenId}:${toolName}:${idempotencyKey ?? ''}:${Date.now()}`;
      return createHash('sha256').update(seed).digest('hex');
    },
  });
}

// Only launch the stdio transport when this module is the process
// entrypoint (the `borjie-mcp-server` binary). Guard so that importing
// this module (e.g. from a unit test of `evalKillSwitchOpen`) does not
// attach to process.stdin and hang.
function isEntrypoint(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  void main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`borjie-mcp-server: fatal: ${msg}\n`);
    process.exit(1);
  });
}
