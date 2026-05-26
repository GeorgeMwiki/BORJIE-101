import { describe, it, expect } from 'vitest';
import { heuristicSpecGenerator } from '../generator/spec-generator.js';
import { createInMemoryInternalToolRepository } from '../repositories/internal-tool.js';
import { createInMemoryToolRunRepository } from '../repositories/tool-run.js';
import { createToolRunner, ToolRunnerError } from '../runner/tool-runner.js';
import type { ToolHandlerPort } from '../types.js';

describe('heuristicSpecGenerator → repo → runner', () => {
  it('generates a T1 read-only report tool from a non-mutating utterance', async () => {
    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance:
        'I want a report that scans worker shift logs for missed safety steps',
    });
    expect(draft.authorityTier).toBe('T1');
    expect(['report', 'extractor']).toContain(draft.kind);
    expect(draft.spec.handler.writesSources).toHaveLength(0);
    expect(draft.spec.auditHook.enabled).toBe(true);
  });

  it('flags an utterance with mutating verbs as T2 and emits writesSources', async () => {
    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance:
        'create and send an alert to safety officers whenever a shift skips checklist',
    });
    expect(draft.authorityTier).toBe('T2');
    expect(draft.spec.handler.writesSources.length).toBeGreaterThan(0);
  });

  it('runs a tool only after it reaches the live lifecycle state', async () => {
    const tools = createInMemoryInternalToolRepository();
    const runs = createInMemoryToolRunRepository();
    const handler: ToolHandlerPort = async () => ({ rowCount: 7 });
    const runner = createToolRunner({ tools, runs, handler });

    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance: 'report missed safety steps in worker shifts',
    });
    const inserted = await tools.insert({
      tenantId: 't1',
      name: draft.name,
      kind: draft.kind,
      spec: draft.spec,
      authorityTier: draft.authorityTier,
    });

    // Attempting to run while still `draft` should fail.
    await expect(
      runner.run({
        tenantId: 't1',
        toolId: inserted.id,
        ranBy: 'user-1',
        inputs: { scope: 'site-A', window_days: 7 },
      }),
    ).rejects.toBeInstanceOf(ToolRunnerError);

    // Advance to staged then live.
    await tools.transitionLifecycle('t1', inserted.id, 'staged');
    await tools.transitionLifecycle('t1', inserted.id, 'live');

    const run = await runner.run({
      tenantId: 't1',
      toolId: inserted.id,
      ranBy: 'user-1',
      inputs: { scope: 'site-A', window_days: 7 },
    });
    expect(run.outputs).toEqual({ rowCount: 7 });
    expect(run.auditHash.length).toBeGreaterThan(0);
  });

  it('rejects runs that omit required inputs', async () => {
    const tools = createInMemoryInternalToolRepository();
    const runs = createInMemoryToolRunRepository();
    const handler: ToolHandlerPort = async () => ({});
    const runner = createToolRunner({ tools, runs, handler });

    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance: 'report missed safety steps',
    });
    const inserted = await tools.insert({
      tenantId: 't1',
      name: draft.name,
      kind: draft.kind,
      spec: draft.spec,
      authorityTier: draft.authorityTier,
    });
    await tools.transitionLifecycle('t1', inserted.id, 'staged');
    await tools.transitionLifecycle('t1', inserted.id, 'live');

    await expect(
      runner.run({
        tenantId: 't1',
        toolId: inserted.id,
        ranBy: 'user-1',
        inputs: {},
      }),
    ).rejects.toMatchObject({ code: 'missing_required_field' });
  });

  it('rejects unknown input fields', async () => {
    const tools = createInMemoryInternalToolRepository();
    const runs = createInMemoryToolRunRepository();
    const handler: ToolHandlerPort = async () => ({});
    const runner = createToolRunner({ tools, runs, handler });

    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance: 'report missed safety steps',
    });
    const inserted = await tools.insert({
      tenantId: 't1',
      name: draft.name,
      kind: draft.kind,
      spec: draft.spec,
      authorityTier: draft.authorityTier,
    });
    await tools.transitionLifecycle('t1', inserted.id, 'staged');
    await tools.transitionLifecycle('t1', inserted.id, 'live');

    await expect(
      runner.run({
        tenantId: 't1',
        toolId: inserted.id,
        ranBy: 'user-1',
        inputs: {
          scope: 'site-A',
          window_days: 5,
          stowaway: 'not allowed',
        },
      }),
    ).rejects.toMatchObject({ code: 'unknown_input_field' });
  });

  it('persists multiple runs and lists them in reverse chronological order', async () => {
    let nowMs = 1_700_000_000_000;
    const tools = createInMemoryInternalToolRepository({
      now: () => new Date(nowMs),
    });
    const runs = createInMemoryToolRunRepository({
      now: () => new Date(nowMs),
    });
    const handler: ToolHandlerPort = async () => ({ ok: true });
    const runner = createToolRunner({ tools, runs, handler });

    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance: 'report missed safety steps',
    });
    const inserted = await tools.insert({
      tenantId: 't1',
      name: draft.name,
      kind: draft.kind,
      spec: draft.spec,
      authorityTier: draft.authorityTier,
    });
    await tools.transitionLifecycle('t1', inserted.id, 'staged');
    await tools.transitionLifecycle('t1', inserted.id, 'live');

    nowMs += 1000;
    await runner.run({
      tenantId: 't1',
      toolId: inserted.id,
      ranBy: 'user-1',
      inputs: { scope: 'site-A', window_days: 1 },
    });
    nowMs += 1000;
    await runner.run({
      tenantId: 't1',
      toolId: inserted.id,
      ranBy: 'user-2',
      inputs: { scope: 'site-B', window_days: 7 },
    });
    const list = await runs.listForTool('t1', inserted.id, 10);
    expect(list).toHaveLength(2);
    expect(list[0]?.ranBy).toBe('user-2');
    expect(list[1]?.ranBy).toBe('user-1');
  });
});
