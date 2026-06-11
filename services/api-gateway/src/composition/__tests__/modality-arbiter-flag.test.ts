/**
 * OK-1 (Wave 1 conductor) — modality-arbiter DEFAULT-ON kill-switch +
 * arbiter-on-routes / arbiter-broken-falls-back-to-legacy.
 *
 *   - `resolveModalityArbiterEnabled` is a DEFAULT-ON kill-switch: only an
 *     explicit off/0/false/no disables it (unset/typo'd → ON);
 *   - when the arbiter handler is wired, a `loop` modality routes through the
 *     real loop-runner adapter (returns a loopRunId);
 *   - when the arbiter handler THROWS (a broken/empty arbiter), the tool
 *     dispatcher falls back to the legacy breadcrumb `modality_ack` — the
 *     turn is NEVER broken.
 */

import { describe, it, expect } from 'vitest';

import { resolveModalityArbiterEnabled } from '../brain-kernel-wiring';
import { createLoopRunnerAdapter } from '../orchestrator-bindings';
import {
  orchestrator,
  createBrainToolRegistry,
  type BrainToolRegistry,
} from '@borjie/central-intelligence';

const TENANT_CTX: orchestrator.HookContext = {
  threadId: 'thread-1',
  scope: {
    kind: 'tenant',
    tenantId: 'tenant-A',
    actorUserId: 'user-1',
    roles: ['owner'],
    personaId: 'mr-mwikila-head',
  },
  tier: 'tenant',
  userMessage: 'set up a recurring tab tick',
  tickStartedAt: Date.now(),
};

describe('resolveModalityArbiterEnabled — OK-1 default-ON kill-switch', () => {
  it('unset → ON (default)', () => {
    expect(resolveModalityArbiterEnabled({})).toBe(true);
  });

  it('a typo / unrecognized value → ON (default-on)', () => {
    expect(resolveModalityArbiterEnabled({ BORJIE_MODALITY_ARBITER: 'yep' })).toBe(true);
    expect(resolveModalityArbiterEnabled({ BORJIE_MODALITY_ARBITER: '' })).toBe(true);
  });

  it('only off/0/false/no disable', () => {
    for (const v of ['off', '0', 'false', 'no', 'OFF', 'False']) {
      expect(resolveModalityArbiterEnabled({ BORJIE_MODALITY_ARBITER: v })).toBe(false);
    }
    for (const v of ['on', '1', 'true', 'enabled']) {
      expect(resolveModalityArbiterEnabled({ BORJIE_MODALITY_ARBITER: v })).toBe(true);
    }
  });
});

describe('modality dispatcher — arbiter-on routes loop; arbiter-broken → legacy', () => {
  const registry: BrainToolRegistry = createBrainToolRegistry();

  it('arbiter ON: a loop modality routes through the real loop-runner adapter', async () => {
    const loopRunner = createLoopRunnerAdapter(null, registry, { env: {} });
    const dispatcher = orchestrator.createToolDispatcher({
      registry,
      modalityHandler: async (a) => {
        if (a.modality === 'loop' || a.modality === 'workflow') {
          const { loopRunId } = await loopRunner.runLoop({
            flowId: String(a.payload.flowId ?? 'adhoc'),
            loopKind: 'tab_tick',
            tenantId: 'tenant-A',
            payload: a.payload,
          });
          return { output: { modality: a.modality, loopRunId } };
        }
        return { output: { modality: a.modality, acked: true } };
      },
    });

    const result = await dispatcher.dispatch(
      { kind: 'run_modality', modality: 'loop', payload: { flowId: 'flow-X' } },
      TENANT_CTX,
    );
    expect(result.kind).toBe('modality_ack');
    if (result.kind === 'modality_ack') {
      const output = result.output as { loopRunId?: string };
      expect(output.loopRunId).toMatch(/^loop_flow-X_/);
    }
  });

  it('arbiter BROKEN: a throwing handler falls back to the legacy breadcrumb', async () => {
    const dispatcher = orchestrator.createToolDispatcher({
      registry,
      modalityHandler: async () => {
        throw new Error('arbiter embedder is empty / broken');
      },
    });

    // The turn MUST NOT throw — the dispatcher swallows + returns the
    // breadcrumb ack so the parent loop continues.
    const result = await dispatcher.dispatch(
      { kind: 'run_modality', modality: 'loop', payload: { flowId: 'flow-Y' } },
      TENANT_CTX,
    );
    expect(result.kind).toBe('modality_ack');
    if (result.kind === 'modality_ack') {
      // Legacy breadcrumb carries no real output.
      expect(result.output).toBeUndefined();
      expect(result.modality).toBe('loop');
    }
  });

  it('arbiter OFF (no handler): the dispatcher returns the legacy breadcrumb', async () => {
    const dispatcher = orchestrator.createToolDispatcher({ registry });
    const result = await dispatcher.dispatch(
      { kind: 'run_modality', modality: 'loop', payload: {} },
      TENANT_CTX,
    );
    expect(result.kind).toBe('modality_ack');
  });
});
