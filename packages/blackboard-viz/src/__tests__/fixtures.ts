/**
 * Test fixtures — small deterministic blackboard streams for the
 * vitest bench. The 10 000-post stress fixture is generated lazily by
 * `makeLargePosts` so unused tests do not pay the allocation cost.
 */

import type {
  BlackboardPost,
  BlackboardAuthor,
  KnowledgeState,
  RegionStatus,
} from '../types';

const KS: readonly KnowledgeState[] = [
  'decision',
  'evidence',
  'question',
  'action',
  'observation',
  'error',
];
const STATUSES: readonly RegionStatus[] = ['open', 'in-progress', 'blocked', 'resolved'];

export const AUTHOR_OWNER: BlackboardAuthor = {
  id: 'mwikila',
  name: 'Mr. Mwikila',
  kind: 'human',
};

export const AUTHOR_JUNIOR: BlackboardAuthor = {
  id: 'agent-jr-pit-safety',
  name: 'Junior Safety Agent',
  kind: 'agent',
};

export function makeSmallPosts(): ReadonlyArray<BlackboardPost> {
  return [
    {
      id: 'p1',
      author: AUTHOR_OWNER,
      createdAt: '2026-05-26T08:00:00Z',
      body: 'Reviewed @agent-jr-pit-safety report on #pit-b inspection.',
      knowledgeState: 'observation',
      region: 'pit-b',
      regionStatus: 'open',
    },
    {
      id: 'p2',
      author: AUTHOR_JUNIOR,
      createdAt: '2026-05-26T08:05:00Z',
      body: 'Confirmed risk on bench 3. Recommend $haul-restriction.',
      knowledgeState: 'evidence',
      region: 'pit-b',
      regionStatus: 'in-progress',
      parentId: 'p1',
      refs: ['p1'],
    },
    {
      id: 'p3',
      author: AUTHOR_OWNER,
      createdAt: '2026-05-26T09:10:00Z',
      body: 'Decision: enforce haul restriction immediately.',
      knowledgeState: 'decision',
      region: 'pit-b',
      regionStatus: 'resolved',
      parentId: 'p2',
      refs: ['p2'],
      reactions: { '👍': 2 },
    },
    {
      id: 'p4',
      author: AUTHOR_JUNIOR,
      createdAt: '2026-05-27T07:30:00Z',
      body: 'Anomaly detected on #leach-tank-3 flow rate.',
      knowledgeState: 'error',
      region: 'leach-tank-3',
      regionStatus: 'blocked',
      editCount: 1,
      updatedAt: '2026-05-27T07:45:00Z',
    },
  ];
}

export function makeLargePosts(count: number): ReadonlyArray<BlackboardPost> {
  const out: BlackboardPost[] = [];
  const day0 = Date.UTC(2026, 0, 1, 8, 0, 0);
  for (let i = 0; i < count; i++) {
    const ks = KS[i % KS.length]!;
    const status = STATUSES[i % STATUSES.length]!;
    const t = new Date(day0 + i * 60_000).toISOString();
    out.push({
      id: `p-${i}`,
      author: i % 3 === 0 ? AUTHOR_OWNER : AUTHOR_JUNIOR,
      createdAt: t,
      body: `Sample post ${i} body — see #region-${i % 5}.`,
      knowledgeState: ks,
      region: `region-${i % 5}`,
      regionStatus: status,
    });
  }
  return out;
}
