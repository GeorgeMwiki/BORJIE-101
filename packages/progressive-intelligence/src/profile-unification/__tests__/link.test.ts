import { describe, expect, it } from 'vitest';
import type { ProfileFragment } from '../../types.js';
import { linkFragments } from '../link.js';

function frag(
  id: string,
  attributes: Record<string, unknown>,
  source: ProfileFragment['source'] = 'crm',
  tenantId = 't1',
): ProfileFragment {
  return {
    id,
    tenantId,
    source,
    attributes,
    capturedAt: '2026-05-01T00:00:00Z',
  };
}

describe('linkFragments', () => {
  it('returns score=1 on shared email', () => {
    const a = frag('a', { email: 'JANE@example.com' });
    const b = frag('b', { email: 'jane@example.com' });
    const link = linkFragments({ fragmentA: a, fragmentB: b });
    expect(link.score).toBe(1);
    expect(link.reasons).toContain('shared_email');
  });

  it('returns score=1 on shared phone (normalized)', () => {
    const a = frag('a', { phone: '+254 (700) 123-456' });
    const b = frag('b', { phone: '254700123456' });
    const link = linkFragments({ fragmentA: a, fragmentB: b });
    expect(link.score).toBe(1);
    expect(link.reasons).toContain('shared_phone');
  });

  it('returns 0 across tenants', () => {
    const a = frag('a', { email: 'jane@example.com' }, 'crm', 't1');
    const b = frag('b', { email: 'jane@example.com' }, 'crm', 't2');
    const link = linkFragments({ fragmentA: a, fragmentB: b });
    expect(link.score).toBe(0);
    expect(link.reasons).toContain('cross_tenant');
  });

  it('honours subjectHintId shortcut', () => {
    const a: ProfileFragment = {
      ...frag('a', {}),
      subjectHintId: 'subj-1',
    };
    const b: ProfileFragment = {
      ...frag('b', {}),
      subjectHintId: 'subj-1',
    };
    const link = linkFragments({ fragmentA: a, fragmentB: b });
    expect(link.score).toBe(1);
    expect(link.reasons).toContain('shared_subject_hint');
  });

  it('returns a low score for unrelated names', () => {
    const a = frag('a', { displayName: 'Jane Doe' });
    const b = frag('b', { displayName: 'Quux Zorblax' });
    const link = linkFragments({ fragmentA: a, fragmentB: b });
    expect(link.score).toBeLessThan(0.5);
    expect(link.reasons).toContain('no_strong_signal');
  });
});
