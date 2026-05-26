/**
 * Audit-chain link factory.
 *
 * Pure helper that produces a fresh `McpAuditLink` from the dispatcher.
 * Lives in its own file so the dispatcher's tests can verify the link
 * shape without re-importing the whole dispatch graph.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §6.
 */

import type { McpAuditLink } from '../types.js';

export interface BuildAuditLinkInput {
  readonly tenantId: string;
  readonly connectionId: string;
  readonly toolName: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'ok' | 'error';
  readonly errorMessage?: string;
}

export function buildAuditLink(input: BuildAuditLinkInput): McpAuditLink {
  if (input.finishedAt < input.startedAt) {
    throw new Error('audit-chain-link: finishedAt < startedAt');
  }
  if (input.outcome === 'error' && !input.errorMessage) {
    throw new Error('audit-chain-link: error outcome requires errorMessage');
  }
  return input.errorMessage
    ? Object.freeze({
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        toolName: input.toolName,
        inputHash: input.inputHash,
        outputHash: input.outputHash,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        outcome: input.outcome,
        errorMessage: input.errorMessage,
      })
    : Object.freeze({
        tenantId: input.tenantId,
        connectionId: input.connectionId,
        toolName: input.toolName,
        inputHash: input.inputHash,
        outputHash: input.outputHash,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        outcome: input.outcome,
      });
}
