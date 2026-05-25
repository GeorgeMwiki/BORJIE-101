/**
 * Preferences service — checkAllowed tests (SCAFFOLDED 8 + NEW 21).
 *
 * Round-3 audit H6 — preferences storage is now adapter-backed. Both
 * `InMemoryPreferencesStore` and `RedisPreferencesStore` MUST satisfy
 * the same behavioural contract; the suite is parameterised by adapter
 * via `describe.each` so a single regression covers both.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPreferencesService,
  type PreferencesService,
} from '../preferences/service.js';
import { InMemoryPreferencesStore } from '../storage/in-memory.js';
import { RedisPreferencesStore } from '../storage/redis.js';
import { createIoredisMock } from './helpers/ioredis-mock.js';

type Factory = () => PreferencesService;

const ADAPTERS: ReadonlyArray<[string, Factory]> = [
  ['InMemory', () => createPreferencesService({ store: new InMemoryPreferencesStore() })],
  [
    'Redis',
    () => {
      const client = createIoredisMock();
      // The mock satisfies the subset of ioredis our adapter uses.
      return createPreferencesService({
        store: new RedisPreferencesStore(client as never),
      });
    },
  ],
];

describe.each(ADAPTERS)('preferencesService.checkAllowed [%s]', (_label, factory) => {
  const tenantId = 'tenant-1';
  const userId = 'user-1';
  let preferencesService: PreferencesService;

  beforeEach(async () => {
    preferencesService = factory();
    // Reset defaults by overwriting with the defaults explicitly
    await preferencesService.upsertPreferences(userId, tenantId, {
      channels: { email: true, sms: true, push: true, whatsapp: true },
      templates: {
        rent_due: true,
        rent_overdue: true,
        payment_received: true,
        maintenance_update: true,
        lease_expiring: true,
        welcome: true,
      },
      quietHoursStart: undefined,
      quietHoursEnd: undefined,
    });
  });

  it('returns allowed:true when channel and template are enabled and no quiet hours', async () => {
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
    });
    expect(result.allowed).toBe(true);
  });

  it('returns channel_disabled when the channel is opted out', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      channels: { sms: false },
    });
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('channel_disabled');
  });

  it('returns template_disabled when the template is opted out', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      templates: { rent_due: false },
    });
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('template_disabled');
  });

  it('returns quiet_hours for normal priority during quiet hours', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
    });
    // 01:00 — inside quiet hours window
    const now = new Date();
    now.setHours(1, 0, 0, 0);
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
      priority: 'normal',
      now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quiet_hours');
  });

  it('bypasses quiet hours for emergency priority', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
    });
    const now = new Date();
    now.setHours(1, 0, 0, 0);
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
      priority: 'emergency',
      now,
    });
    expect(result.allowed).toBe(true);
  });

  it('still blocks emergency when channel is opted out', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      channels: { sms: false },
    });
    const result = await preferencesService.checkAllowed({
      userId,
      tenantId,
      channel: 'sms',
      templateId: 'rent_due',
      priority: 'emergency',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('channel_disabled');
  });

  it('persists preference updates across reads', async () => {
    await preferencesService.upsertPreferences(userId, tenantId, {
      channels: { whatsapp: false },
    });
    const prefs = await preferencesService.getPreferences(userId, tenantId);
    expect(prefs.channels.whatsapp).toBe(false);
  });
});
