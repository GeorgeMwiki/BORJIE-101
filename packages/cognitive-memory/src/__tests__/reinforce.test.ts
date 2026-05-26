/**
 * Reinforce operation tests (Wave 18AA).
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { createObserve } from '../operations/observe.js';
import { createReinforce } from '../operations/reinforce.js';
import { createInMemoryCellRepository } from '../storage/cell-repository.js';
import { createInMemoryReinforcementRepository } from '../storage/reinforcement-repository.js';
import { EMBEDDING_DIM, type EmbeddingService } from '../types.js';

function deterministicEmbedder(): EmbeddingService {
  return {
    async embed(text: string): Promise<ReadonlyArray<number>> {
      const vec = new Array<number>(EMBEDDING_DIM).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        const slot = i % EMBEDDING_DIM;
        vec[slot] = (vec[slot] ?? 0) + text.charCodeAt(i);
      }
      return vec;
    },
  };
}

let counter = 0;
const seqId = (): string => {
  counter += 1;
  return `id-${counter.toString().padStart(4, '0')}`;
};

describe('memory.reinforce', () => {
  it('appends reinforcer and promotes observed → reinforced after 2 distinct others', async () => {
    const cells = createInMemoryCellRepository();
    const reinforcements = createInMemoryReinforcementRepository();
    const audit = createInMemoryAuditChain();
    const embedder = deterministicEmbedder();

    const observe = createObserve({
      cells,
      embedder,
      audit,
      id: seqId,
      now: () => '2026-05-26T09:00:00.000Z',
    });
    const reinforce = createReinforce({
      cells,
      reinforcements,
      audit,
      id: seqId,
      now: () => '2026-05-26T10:00:00.000Z',
    });

    const cell = await observe(
      { content_text: 'Owner prefers monthly reports', kind: 'preference' },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'reporting',
        turn_id: 'turn-1',
      },
    );
    expect(cell.promotion_status).toBe('observed');

    // First other reinforcer — still observed.
    const after1 = await reinforce(
      { cell_id: cell.id },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'compliance',
        turn_id: 'turn-2',
      },
    );
    expect(after1.promotion_status).toBe('observed');
    expect(after1.reinforced_by_specialisations).toContain('compliance');

    // Second distinct other reinforcer — promotion fires.
    const after2 = await reinforce(
      { cell_id: cell.id },
      {
        tenant_id: 't1',
        scope_id: 'tenant_root',
        specialisation: 'finance',
        turn_id: 'turn-3',
      },
    );
    expect(after2.promotion_status).toBe('reinforced');
    expect(after2.promoted_at).not.toBeNull();
  });

  it('rejects reinforce on a non-existent cell', async () => {
    const cells = createInMemoryCellRepository();
    const reinforcements = createInMemoryReinforcementRepository();
    const audit = createInMemoryAuditChain();
    const reinforce = createReinforce({
      cells,
      reinforcements,
      audit,
      id: seqId,
    });
    await expect(
      reinforce(
        { cell_id: 'nope' },
        {
          tenant_id: 't1',
          scope_id: 'tenant_root',
          specialisation: 's',
          turn_id: 'tx',
        },
      ),
    ).rejects.toMatchObject({ code: 'reinforce.cell_not_found' });
  });
});
