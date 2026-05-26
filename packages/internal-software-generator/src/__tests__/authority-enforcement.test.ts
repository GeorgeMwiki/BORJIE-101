import { describe, it, expect } from 'vitest';
import { canTransition } from '../lifecycle/tool-lifecycle.js';
import { createInMemoryInternalToolRepository } from '../repositories/internal-tool.js';
import { heuristicSpecGenerator } from '../generator/spec-generator.js';

describe('authority enforcement — T2 tools require owner sign before going live', () => {
  it('blocks staged → live on a T2 tool until owner-sign is supplied', async () => {
    // Use the lifecycle helper directly to confirm the policy boundary.
    const blocked = canTransition({
      from: 'staged',
      to: 'live',
      authorityTier: 'T2',
    });
    expect(blocked.ok).toBe(false);

    const signed = canTransition({
      from: 'staged',
      to: 'live',
      authorityTier: 'T2',
      ownerSign: 'sig-v1',
    });
    expect(signed.ok).toBe(true);
  });

  it('records authority_tier on the inserted tool and surfaces it on read', async () => {
    const repo = createInMemoryInternalToolRepository();
    const draft = await heuristicSpecGenerator({
      tenantId: 't1',
      ownerUtterance:
        'create and send notifications to safety officers when a shift skips a checklist',
    });
    expect(draft.authorityTier).toBe('T2');
    const inserted = await repo.insert({
      tenantId: 't1',
      name: draft.name,
      kind: draft.kind,
      spec: draft.spec,
      authorityTier: draft.authorityTier,
    });
    const fetched = await repo.findById('t1', inserted.id);
    expect(fetched?.authorityTier).toBe('T2');
  });
});
