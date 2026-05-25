import { describe, expect, it } from 'vitest';

import {
  MockSlackSink,
  MockSovereignLedgerSink,
  buildEntry,
  createAuditHook,
  isAuditedTool,
} from './create-audit-hook.js';
import { type PostToolUseInput } from './types.js';

const baseInput: PostToolUseInput = {
  toolName: 'Write',
  toolInput: { file_path: 'packages/x/y.ts', content: 'hello' },
  actor: 'brain-self-codegen',
  tenantId: 'tenant-borjie',
  sessionId: 'sess-1',
  commitSha: 'abc1234',
};

describe('post-tool-audit-hook — isAuditedTool', () => {
  it('audits Write/Edit/Delete/MultiEdit/NotebookEdit', () => {
    for (const t of ['Write', 'Edit', 'Delete', 'MultiEdit', 'NotebookEdit']) {
      expect(isAuditedTool(t)).toBe(true);
    }
  });

  it('does not audit Read/Grep/Bash', () => {
    for (const t of ['Read', 'Grep', 'Bash']) {
      expect(isAuditedTool(t)).toBe(false);
    }
  });
});

describe('post-tool-audit-hook — buildEntry', () => {
  it('builds a frozen ForensicEntry with all required fields', () => {
    const e = buildEntry(baseInput);
    expect(e.actor).toBe('brain-self-codegen');
    expect(e.tenantId).toBe('tenant-borjie');
    expect(e.file).toBe('packages/x/y.ts');
    expect(e.op).toBe('Write');
    expect(e.commitSha).toBe('abc1234');
    expect(e.sessionId).toBe('sess-1');
    expect(typeof e.takenAt).toBe('string');
  });

  it('summarizes diff when old/new strings are present', () => {
    const e = buildEntry({
      ...baseInput,
      toolName: 'Edit',
      toolInput: { file_path: 'x', old_string: 'a', new_string: 'bcd' },
    });
    expect(e.diffSummary).toMatch(/Edit replace 1→3 chars/);
  });

  it('uses toolResult.diffSummary when available', () => {
    const e = buildEntry({ ...baseInput, toolResult: { diffSummary: 'custom' } });
    expect(e.diffSummary).toBe('custom');
  });

  it('falls back to <unknown> when file_path is missing', () => {
    const e = buildEntry({
      ...baseInput,
      toolInput: { content: 'hi' },
    });
    expect(e.file).toBe('<unknown>');
  });
});

describe('post-tool-audit-hook — createAuditHook', () => {
  it('emits to BOTH sinks for audited ops', async () => {
    const ledger = new MockSovereignLedgerSink();
    const slack = new MockSlackSink();
    const hook = createAuditHook({ sovereignLedger: ledger, slack });
    const result = await hook(baseInput);
    expect(result.async).toBe(true);
    // Allow microtask fan-out
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(ledger.received).toHaveLength(1);
    expect(slack.received).toHaveLength(1);
  });

  it('skips audit for non-audited tools but still returns async ack', async () => {
    const ledger = new MockSovereignLedgerSink();
    const slack = new MockSlackSink();
    const hook = createAuditHook({ sovereignLedger: ledger, slack });
    await hook({ ...baseInput, toolName: 'Read' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(ledger.received).toHaveLength(0);
    expect(slack.received).toHaveLength(0);
  });

  it('calls onError when ledger fails but does not throw', async () => {
    let captured: Error | undefined;
    const ledger = {
      appendForensicEntry: async () => {
        throw new Error('ledger-down');
      },
    };
    const hook = createAuditHook({
      sovereignLedger: ledger,
      onError: (e) => {
        captured = e;
      },
    });
    await expect(hook(baseInput)).resolves.toBeTruthy();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(captured?.message).toBe('ledger-down');
  });

  it('works with no Slack sink configured (sovereign-only)', async () => {
    const ledger = new MockSovereignLedgerSink();
    const hook = createAuditHook({ sovereignLedger: ledger });
    await hook(baseInput);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(ledger.received).toHaveLength(1);
  });
});
