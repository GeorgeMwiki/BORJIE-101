import { describe, it, expect } from 'vitest';
import { createBlackboardPoster } from '../blackboard/blackboard-poster.js';
import { createBlackboardReader } from '../blackboard/blackboard-reader.js';
import {
  findOrphanSupersedences,
  resolveTipPostings,
} from '../blackboard/supersedence-resolver.js';
import { createInMemoryBlackboardRepository } from '../storage/blackboard-repository.js';

describe('blackboard-poster', () => {
  it('posts an observation', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    const result = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'safety',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'observation',
      payload: { measurement: 'co2', value: 412 },
    });
    expect(result.posting.contributionKind).toBe('observation');
    expect(result.warning).toBeNull();
  });

  it('warns when posting an unsuperseded plan over an existing one', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { step: 'A' },
    });
    const second = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'b',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { step: 'B' },
    });
    expect(second.warning).not.toBeNull();
  });

  it('does not warn when supersedence is supplied', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    const first = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { step: 'A' },
    });
    const second = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'b',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { step: 'B' },
      supersedesPostingId: first.posting.id,
    });
    expect(second.warning).toBeNull();
  });
});

describe('blackboard-reader', () => {
  it('filters out superseded postings by default', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    const reader = createBlackboardReader(repo);
    const first = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { v: 1 },
    });
    await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'result',
      payload: { done: true },
      supersedesPostingId: first.posting.id,
    });
    const live = await reader.readSubject('t1', { kind: 'parcel', id: 'P1' });
    expect(live.length).toBe(1);
    expect(live[0]?.contributionKind).toBe('result');
  });

  it('returns full history on readWithSuperseded', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    const reader = createBlackboardReader(repo);
    const first = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { v: 1 },
    });
    await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'result',
      payload: { done: true },
      supersedesPostingId: first.posting.id,
    });
    const all = await reader.readWithSuperseded('t1', {
      kind: 'parcel',
      id: 'P1',
    });
    expect(all.length).toBe(2);
  });
});

describe('supersedence-resolver helpers', () => {
  it('resolveTipPostings returns only non-superseded rows', async () => {
    const repo = createInMemoryBlackboardRepository();
    const poster = createBlackboardPoster(repo);
    const first = await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'plan',
      payload: { v: 1 },
    });
    await poster.post({
      tenantId: 't1',
      postedByAgentId: 'a',
      subject: { kind: 'parcel', id: 'P1' },
      contributionKind: 'result',
      payload: { done: true },
      supersedesPostingId: first.posting.id,
    });
    const all = await repo.readSubject('t1', { kind: 'parcel', id: 'P1' });
    const tips = resolveTipPostings(all);
    expect(tips.length).toBe(1);
    expect(tips[0]?.contributionKind).toBe('result');
  });

  it('findOrphanSupersedences detects dangling refs', () => {
    const orphans = findOrphanSupersedences([
      {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: 't1',
        scopeId: null,
        postedByAgentId: 'a',
        subject: { kind: 'k', id: 'i' },
        contributionKind: 'plan',
        payload: {},
        supersedesPostingId: 'unknown-id',
        postedAt: new Date(),
        auditHash: 'h',
      },
    ]);
    expect(orphans.length).toBe(1);
  });
});
