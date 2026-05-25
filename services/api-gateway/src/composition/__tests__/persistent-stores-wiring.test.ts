import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPersistentStores } from '../persistent-stores-wiring.js';

const FLAGS = [
  'PERSISTENT_LESSON_STORE_DISABLED',
  'PERSISTENT_WORM_AUDIT_DISABLED',
  'PERSISTENT_SKILL_REGISTRY_DISABLED',
  'PERSISTENT_AOP_REGISTRY_DISABLED',
  'PERSISTENT_A2A_TASKS_DISABLED',
] as const;

const savedEnv: Record<string, string | undefined> = {};

function clearAllFlags() {
  for (const f of FLAGS) {
    savedEnv[f] = process.env[f];
    delete process.env[f];
  }
}

function restoreEnv() {
  for (const f of FLAGS) {
    if (savedEnv[f] === undefined) {
      delete process.env[f];
    } else {
      process.env[f] = savedEnv[f];
    }
  }
}

describe('createPersistentStores', () => {
  beforeEach(() => {
    clearAllFlags();
  });
  afterEach(() => {
    restoreEnv();
  });

  it('returns ALL in-memory stores when db is null', () => {
    const stores = createPersistentStores({ db: null });
    expect(stores.modeByStore['lessonStore']).toBe('memory');
    expect(stores.modeByStore['wormAuditStore']).toBe('memory');
    expect(stores.modeByStore['skillRegistryWriter']).toBe('memory');
    expect(stores.modeByStore['aopRegistryStore']).toBe('memory');
    const taskStore = stores.getA2aTaskStore('tenant-x');
    expect(taskStore).toBeDefined();
    expect(stores.modeByStore['a2aTaskStore']).toBe('memory');
  });

  it('caches a2a task stores per tenant', () => {
    const stores = createPersistentStores({ db: null });
    const a = stores.getA2aTaskStore('tenant-a');
    const b = stores.getA2aTaskStore('tenant-a');
    expect(a).toBe(b);
  });

  it('builds distinct a2a task stores per tenant', () => {
    const stores = createPersistentStores({ db: null });
    const a = stores.getA2aTaskStore('tenant-a');
    const b = stores.getA2aTaskStore('tenant-b');
    expect(a).not.toBe(b);
  });

  it('refuses empty tenantId on getA2aTaskStore', () => {
    const stores = createPersistentStores({ db: null });
    expect(() => stores.getA2aTaskStore('')).toThrow(/tenantId/);
  });

  it('forces memory mode when a per-store flag is enabled even with db', () => {
    process.env['PERSISTENT_LESSON_STORE_DISABLED'] = '1';
    const stores = createPersistentStores({ db: {} as unknown });
    expect(stores.modeByStore['lessonStore']).toBe('memory');
    // Others go persistent because their flags are off.
    expect(stores.modeByStore['wormAuditStore']).toBe('persistent');
  });

  it('emits a debug-log entry naming the modes used', () => {
    const calls: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
    createPersistentStores({
      db: null,
      logger: { info: (obj, msg) => calls.push({ obj, msg }) },
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.obj['modeByStore']).toBeDefined();
  });

  it('lesson-store fallback satisfies the LessonStore interface (put + recent)', async () => {
    const stores = createPersistentStores({ db: null });
    await stores.lessonStore.put({
      id: '',
      tenantId: 't1',
      taskTag: 'eviction',
      lesson: 'Always cite §53 before serving notice.',
      evidence: '',
      createdAt: '2026-05-24T00:00:00.000Z',
      recencyScore: 0.5,
    });
    const recent = await stores.lessonStore.recent('t1', 'eviction', 10);
    expect(recent.length).toBeGreaterThan(0);
  });
});
