/**
 * Persona registry tests (Phase D D7).
 *
 * Targets: register / get / list / update / delete / refresh, plus
 * hydration semantics + deep-clone safety + unknown-id error path.
 */

import { describe, it, expect } from 'vitest';
import {
  createPersonaRegistry,
  createInMemoryPersonaRegistryStore,
} from '../persona-registry.js';
import type { PersonaIdentity } from '../../identity.js';

function p(id: string, overrides: Partial<PersonaIdentity> = {}): PersonaIdentity {
  return {
    id,
    displayName: `Display ${id}`,
    openingStatement: 'I am here.',
    toneGuidance: 'Calm.',
    taboos: ['none'],
    violationSignals: ['violation'],
    firstPersonNoun: 'I',
    ...overrides,
  };
}

describe('Phase D D7 — PersonaRegistry', () => {
  it('register() persists a new persona', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    const created = await reg.register(p('alpha'));
    expect(created.id).toBe('alpha');
    expect(reg.get('alpha')?.displayName).toBe('Display alpha');
  });

  it('get() returns null for unknown id', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    expect(reg.get('nope')).toBeNull();
  });

  it('list() returns all registered personas', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await reg.register(p('a'));
    await reg.register(p('b'));
    await reg.register(p('c'));
    expect(reg.list()).toHaveLength(3);
  });

  it('hydrates the in-memory cache from the store on construction', async () => {
    const seeded = createInMemoryPersonaRegistryStore([
      p('s1'),
      p('s2'),
    ]);
    const reg = await createPersonaRegistry({ store: seeded });
    expect(reg.get('s1')).not.toBeNull();
    expect(reg.get('s2')).not.toBeNull();
  });

  it('seed applies BEFORE store rows on hydrate (store wins on conflict)', async () => {
    const store = createInMemoryPersonaRegistryStore([
      p('warmth', { displayName: 'From store' }),
    ]);
    const reg = await createPersonaRegistry({
      store,
      seed: [p('warmth', { displayName: 'From seed' })],
    });
    expect(reg.get('warmth')?.displayName).toBe('From store');
  });

  it('update() patches an existing persona and persists', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await reg.register(p('warmth'));
    const next = await reg.update('warmth', {
      openingStatement: 'New opening',
      toneGuidance: 'Warmer.',
    });
    expect(next.openingStatement).toBe('New opening');
    expect(reg.get('warmth')?.toneGuidance).toBe('Warmer.');
  });

  it('update() throws when the persona id is unknown', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await expect(reg.update('nope', {})).rejects.toThrow(/unknown persona/i);
  });

  it('delete() removes a persona and returns true', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await reg.register(p('drop-me'));
    const removed = await reg.delete('drop-me');
    expect(removed).toBe(true);
    expect(reg.get('drop-me')).toBeNull();
  });

  it('delete() returns false for unknown id', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    const removed = await reg.delete('phantom');
    expect(removed).toBe(false);
  });

  it('list() returns deep copies — callers cannot mutate the cache', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await reg.register(p('immutable'));
    const snapshot = reg.list();
    (snapshot[0] as { displayName: string }).displayName = 'mutated';
    expect(reg.get('immutable')?.displayName).toBe('Display immutable');
  });

  it('refresh() re-reads from the store and reconciles the cache', async () => {
    const store = createInMemoryPersonaRegistryStore([p('seeded')]);
    const reg = await createPersonaRegistry({ store });
    // Mutate the store directly behind the registry's back, then refresh.
    await store.upsert(p('seeded', { displayName: 'fresh' }));
    await store.upsert(p('newcomer'));
    await reg.refresh();
    expect(reg.get('seeded')?.displayName).toBe('fresh');
    expect(reg.get('newcomer')).not.toBeNull();
  });

  it('register() rejects an empty id', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    await expect(
      reg.register(p('').withInvalidId ? p('') : (p('') as PersonaIdentity)),
    ).rejects.toThrow(/id is required/i);
  });

  it('preserves taboos + violationSignals as deep copies on register', async () => {
    const reg = await createPersonaRegistry({
      store: createInMemoryPersonaRegistryStore(),
    });
    const taboos = ['t1', 't2'];
    const signals = ['s1'];
    await reg.register(p('deep', { taboos, violationSignals: signals }));
    taboos.push('mutated');
    signals.push('mutated');
    expect(reg.get('deep')?.taboos).toEqual(['t1', 't2']);
    expect(reg.get('deep')?.violationSignals).toEqual(['s1']);
  });
});
