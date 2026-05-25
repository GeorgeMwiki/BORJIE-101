/**
 * `@borjie/litfin-port-tools-extra` — public surface.
 *
 * LITFIN-ported tool + connector + MCP + agency patterns:
 *   - MCP server formatters: Slack message, Linear issue, GitHub PR
 *   - tool-decomposition with `{$bind}` placeholders + compound runner
 *   - saga-style multi-step orchestrator with reverse-order compensation
 *   - per-vendor retry/backoff (Stripe, M-Pesa, Twilio, OpenAI)
 *   - A2A agent-card format with skill discovery
 */

export * from './mcp-formatters.js';
export * from './tool-decomposition.js';
export * from './saga-orchestrator.js';
export * from './retry-backoff.js';
export * from './a2a-agent-card.js';
