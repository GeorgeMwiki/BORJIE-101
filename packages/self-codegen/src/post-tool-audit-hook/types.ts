/**
 * PostToolUse audit hook types.
 *
 * Pattern #11 from R-CODEGEN: async forensic trail to sovereign-ledger AND
 * Slack. Every Write/Edit/Delete generates an entry. Belt-and-suspenders to
 * K-E's "audit-everything" principle.
 */

export type AuditedOp = 'Write' | 'Edit' | 'Delete' | 'MultiEdit' | 'NotebookEdit';

export interface ForensicEntry {
  readonly actor: string;
  readonly tenantId: string;
  readonly file: string;
  readonly op: AuditedOp;
  readonly diffSummary: string;
  readonly takenAt: string;
  readonly commitSha?: string;
  readonly sessionId?: string;
}

export interface PostToolUseInput {
  readonly toolName: string;
  readonly toolInput: {
    readonly file_path?: string;
    readonly old_string?: string;
    readonly new_string?: string;
    readonly content?: string;
  };
  readonly toolResult?: { readonly diffSummary?: string };
  readonly actor: string;
  readonly tenantId: string;
  readonly sessionId?: string;
  readonly commitSha?: string;
}

export interface SovereignLedgerSink {
  appendForensicEntry(entry: ForensicEntry): Promise<void>;
}

export interface SlackSink {
  postToWebhook(entry: ForensicEntry): Promise<void>;
}
