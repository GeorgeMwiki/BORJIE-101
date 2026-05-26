import { describe, expect, it } from 'vitest';

import {
  createInMemoryAmbientCapturesRepository,
} from '../repositories/ambient-captures.js';
import {
  createInMemoryAmbientConsentsRepository,
} from '../repositories/ambient-consents.js';
import {
  createInMemoryKillSwitchEventsRepository,
} from '../repositories/kill-switch-events.js';
import type {
  AmbientCapture,
  AmbientConsent,
  KillSwitchEvent,
} from '../types.js';

const TENANT = 'tenant-repo-001';
const USER = '00000000-0000-0000-0000-000000000001';

function buildConsent(overrides: Partial<AmbientConsent> = {}): AmbientConsent {
  return {
    tenant_id: TENANT,
    user_id: USER,
    channel: 'chat',
    consent_state: 'granted',
    sentiment_consent: false,
    granted_at: '2026-05-26T08:00:00.000Z',
    revoked_at: null,
    granted_by: '00000000-0000-0000-0000-000000000099',
    audit_hash: 'aud-1',
    ...overrides,
  };
}

function buildCapture(overrides: Partial<AmbientCapture> = {}): AmbientCapture {
  return {
    id: 'capture-1',
    tenant_id: TENANT,
    user_id: USER,
    channel: 'voice_call',
    source_session_id: 'session-1',
    captured_at: '2026-05-26T08:00:00.000Z',
    redacted_text: 'Ukaguzi wa NEMC.',
    intent: 'book_inspection',
    entities: [],
    sentiment: null,
    audit_hash: 'aud-cap-1',
    prev_hash: null,
    ...overrides,
  };
}

function buildKillSwitch(
  overrides: Partial<KillSwitchEvent> = {},
): KillSwitchEvent {
  return {
    id: 'ks-1',
    tenant_id: TENANT,
    triggered_by: '00000000-0000-0000-0000-000000000099',
    triggered_at: '2026-05-26T08:00:00.000Z',
    reason: 'test',
    scope: 'user',
    target_user_id: USER,
    audit_hash: 'aud-ks-1',
    ...overrides,
  };
}

describe('AmbientConsentsRepository (in-memory)', () => {
  it('upsert + get round-trip', async () => {
    const repo = createInMemoryAmbientConsentsRepository();
    await repo.upsert(buildConsent());
    const read = await repo.get(TENANT, USER, 'chat');
    expect(read?.audit_hash).toBe('aud-1');
    expect(read?.consent_state).toBe('granted');
  });

  it('returns null for missing rows', async () => {
    const repo = createInMemoryAmbientConsentsRepository();
    expect(await repo.get(TENANT, USER, 'voice_call')).toBeNull();
  });

  it('listForUser returns rows sorted by channel', async () => {
    const repo = createInMemoryAmbientConsentsRepository();
    await repo.upsert(buildConsent({ channel: 'voice_call' }));
    await repo.upsert(buildConsent({ channel: 'chat' }));
    await repo.upsert(buildConsent({ channel: 'sms' }));
    const list = await repo.listForUser(TENANT, USER);
    expect(list.map((r) => r.channel)).toEqual(['chat', 'sms', 'voice_call']);
  });

  it('upsert overwrites the prior row for the same composite key', async () => {
    const repo = createInMemoryAmbientConsentsRepository();
    await repo.upsert(buildConsent({ audit_hash: 'aud-original' }));
    await repo.upsert(buildConsent({ audit_hash: 'aud-updated' }));
    const read = await repo.get(TENANT, USER, 'chat');
    expect(read?.audit_hash).toBe('aud-updated');
  });
});

describe('AmbientCapturesRepository (in-memory)', () => {
  it('insert + latestForSession returns the most recent row', async () => {
    const repo = createInMemoryAmbientCapturesRepository();
    await repo.insert(
      buildCapture({ id: 'cap-1', captured_at: '2026-05-26T08:00:00Z' }),
    );
    await repo.insert(
      buildCapture({ id: 'cap-2', captured_at: '2026-05-26T08:01:00Z' }),
    );
    const latest = await repo.latestForSession(TENANT, 'session-1');
    expect(latest?.id).toBe('cap-2');
  });

  it('listForUser returns rows sorted by captured_at asc', async () => {
    const repo = createInMemoryAmbientCapturesRepository();
    await repo.insert(
      buildCapture({ id: 'cap-2', captured_at: '2026-05-26T09:00:00Z' }),
    );
    await repo.insert(
      buildCapture({ id: 'cap-1', captured_at: '2026-05-26T08:00:00Z' }),
    );
    const list = await repo.listForUser(TENANT, USER);
    expect(list.map((r) => r.id)).toEqual(['cap-1', 'cap-2']);
  });
});

describe('KillSwitchEventsRepository (in-memory)', () => {
  it('isActive is false on empty repo', async () => {
    const repo = createInMemoryKillSwitchEventsRepository();
    const status = await repo.isActive(
      TENANT,
      USER,
      new Date('2026-05-26T08:00:00Z'),
    );
    expect(status.active).toBe(false);
  });

  it('user-scope event flips isActive for the matching user only', async () => {
    const repo = createInMemoryKillSwitchEventsRepository();
    await repo.insert(
      buildKillSwitch({
        scope: 'user',
        target_user_id: USER,
        triggered_at: '2026-05-26T08:00:00Z',
      }),
    );
    const now = new Date('2026-05-26T08:30:00Z');
    expect((await repo.isActive(TENANT, USER, now)).active).toBe(true);
    expect(
      (
        await repo.isActive(
          TENANT,
          '00000000-0000-0000-0000-000000099999',
          now,
        )
      ).active,
    ).toBe(false);
  });

  it('org-scope event flips isActive for every user in tenant', async () => {
    const repo = createInMemoryKillSwitchEventsRepository();
    await repo.insert(
      buildKillSwitch({
        scope: 'org',
        target_user_id: null,
        triggered_at: '2026-05-26T08:00:00Z',
      }),
    );
    const now = new Date('2026-05-26T08:30:00Z');
    const a = await repo.isActive(TENANT, USER, now);
    const b = await repo.isActive(
      TENANT,
      '00000000-0000-0000-0000-000000099999',
      now,
    );
    expect(a.scope).toBe('org');
    expect(b.scope).toBe('org');
  });

  it('listForTenant returns rows sorted by triggered_at asc', async () => {
    const repo = createInMemoryKillSwitchEventsRepository();
    await repo.insert(
      buildKillSwitch({ id: 'b', triggered_at: '2026-05-26T09:00:00Z' }),
    );
    await repo.insert(
      buildKillSwitch({ id: 'a', triggered_at: '2026-05-26T08:00:00Z' }),
    );
    const list = await repo.listForTenant(TENANT);
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
