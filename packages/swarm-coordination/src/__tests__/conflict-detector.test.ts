import { describe, it, expect } from 'vitest';
import { createConflictDetector } from '../conflict/conflict-detector.js';
import { createInMemoryConflictsRepository } from '../storage/conflicts-repository.js';

describe('conflict-detector', () => {
  it('does not open a conflict for a single proposal', async () => {
    const repo = createInMemoryConflictsRepository();
    const detector = createConflictDetector({ repository: repo });
    const result = await detector.detect(
      't1',
      { kind: 'parcel', id: 'P1' },
      [
        {
          proposalId: 'p1',
          proposedByAgentId: 'a',
          subject: { kind: 'parcel', id: 'P1' },
        },
      ],
    );
    expect(result.reason).toBe('no_conflict');
    expect(result.conflictOpened).toBeNull();
  });

  it('does not open a conflict for proposals from the same agent', async () => {
    const repo = createInMemoryConflictsRepository();
    const detector = createConflictDetector({ repository: repo });
    const result = await detector.detect(
      't1',
      { kind: 'parcel', id: 'P1' },
      [
        {
          proposalId: 'p1',
          proposedByAgentId: 'a',
          subject: { kind: 'parcel', id: 'P1' },
        },
        {
          proposalId: 'p2',
          proposedByAgentId: 'a',
          subject: { kind: 'parcel', id: 'P1' },
        },
      ],
    );
    expect(result.reason).toBe('self_only');
    expect(result.conflictOpened).toBeNull();
  });

  it('opens a conflict for proposals from different agents', async () => {
    const repo = createInMemoryConflictsRepository();
    const detector = createConflictDetector({ repository: repo });
    const result = await detector.detect(
      't1',
      { kind: 'parcel', id: 'P1' },
      [
        {
          proposalId: 'p1',
          proposedByAgentId: 'a',
          subject: { kind: 'parcel', id: 'P1' },
        },
        {
          proposalId: 'p2',
          proposedByAgentId: 'b',
          subject: { kind: 'parcel', id: 'P1' },
        },
      ],
    );
    expect(result.reason).toBe('opened');
    expect(result.conflictOpened).not.toBeNull();
    expect(result.conflictOpened?.conflictingProposalIds.length).toBe(2);
  });
});
