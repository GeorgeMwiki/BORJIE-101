/**
 * createAuditHook — returns a PostToolUse hook that emits a forensic entry
 * to the sovereign ledger AND (optionally) to Slack.
 *
 * The hook is intentionally async — it returns immediately so the agent
 * loop is never blocked. Failures are surfaced via the `onError` callback.
 */

import {
  type AuditedOp,
  type ForensicEntry,
  type PostToolUseInput,
  type SlackSink,
  type SovereignLedgerSink,
} from './types.js';

const AUDITED_OPS: ReadonlySet<AuditedOp> = new Set([
  'Write',
  'Edit',
  'Delete',
  'MultiEdit',
  'NotebookEdit',
]);

export interface CreateAuditHookArgs {
  readonly sovereignLedger: SovereignLedgerSink;
  readonly slack?: SlackSink;
  readonly onError?: (err: Error, entry: ForensicEntry) => void;
}

export type PostToolUseHook = (
  input: PostToolUseInput,
) => Promise<{ async: true; asyncTimeout: number }>;

export function createAuditHook(args: CreateAuditHookArgs): PostToolUseHook {
  return async (input: PostToolUseInput) => {
    if (!isAuditedTool(input.toolName)) {
      // Still return the async ack so the agent loop is uniform.
      return { async: true, asyncTimeout: 5000 } as const;
    }
    const entry = buildEntry(input);
    // Fire-and-forget BUT track failures via onError. Both sinks always run.
    fanOut(args, entry);
    return { async: true, asyncTimeout: 5000 } as const;
  };
}

function fanOut(args: CreateAuditHookArgs, entry: ForensicEntry): void {
  args.sovereignLedger
    .appendForensicEntry(entry)
    .catch((e: unknown) => args.onError?.(e as Error, entry));
  if (args.slack) {
    args.slack
      .postToWebhook(entry)
      .catch((e: unknown) => args.onError?.(e as Error, entry));
  }
}

export function buildEntry(input: PostToolUseInput): ForensicEntry {
  const diffSummary =
    input.toolResult?.diffSummary ?? summarizeDiffFromToolInput(input);
  return Object.freeze<ForensicEntry>({
    actor: input.actor,
    tenantId: input.tenantId,
    file: input.toolInput.file_path ?? '<unknown>',
    op: input.toolName as AuditedOp,
    diffSummary,
    takenAt: new Date().toISOString(),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
  });
}

export function isAuditedTool(toolName: string): boolean {
  return AUDITED_OPS.has(toolName as AuditedOp);
}

function summarizeDiffFromToolInput(input: PostToolUseInput): string {
  if (input.toolInput.old_string !== undefined && input.toolInput.new_string !== undefined) {
    const oldLen = input.toolInput.old_string.length;
    const newLen = input.toolInput.new_string.length;
    return `${input.toolName} replace ${oldLen}→${newLen} chars`;
  }
  if (input.toolInput.content !== undefined) {
    return `${input.toolName} ${input.toolInput.content.length} chars`;
  }
  return `${input.toolName} (no inline content)`;
}

/**
 * Mock Slack webhook sink — used by tests and local dev.
 * Production wires a real `fetch` to process.env.SLACK_WEBHOOK.
 */
export class MockSlackSink implements SlackSink {
  public readonly received: ForensicEntry[] = [];
  public async postToWebhook(entry: ForensicEntry): Promise<void> {
    this.received.push(entry);
  }
}

/**
 * Mock sovereign ledger — used by tests + local dev. Production wires the
 * @borjie/observability audit logger.
 */
export class MockSovereignLedgerSink implements SovereignLedgerSink {
  public readonly received: ForensicEntry[] = [];
  public async appendForensicEntry(entry: ForensicEntry): Promise<void> {
    this.received.push(entry);
  }
}
