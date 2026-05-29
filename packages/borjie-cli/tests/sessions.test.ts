import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveSession,
  deleteSession,
  listSessions,
  loadSession,
  mostRecentSessionId,
  newSession,
  touchSession,
} from '../src/sessions.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'borjie-cli-sess-'));
  process.env['BORJIE_HOME'] = dir;
});

afterEach(() => {
  delete process.env['BORJIE_HOME'];
  rmSync(dir, { recursive: true, force: true });
});

describe('sessions store', () => {
  it('creates and reloads a session', () => {
    const s = newSession({ profile: 'default', language: 'sw', title: 'first' });
    const loaded = loadSession(s.id);
    expect(loaded?.title).toBe('first');
    expect(loaded?.turns).toBe(0);
  });

  it('increments turns on touch', () => {
    const s = newSession({ profile: 'default', language: 'sw' });
    touchSession(s.id, { increment: true });
    touchSession(s.id, { increment: true });
    expect(loadSession(s.id)?.turns).toBe(2);
  });

  it('archives + lists active vs all', () => {
    const a = newSession({ profile: 'default', language: 'sw' });
    const b = newSession({ profile: 'default', language: 'sw' });
    archiveSession(a.id);
    expect(listSessions().map((s) => s.id)).toEqual([b.id]);
    expect(listSessions({ includeArchived: true }).map((s) => s.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it('returns the most recent session id', () => {
    const a = newSession({ profile: 'default', language: 'sw' });
    expect(mostRecentSessionId()).toBe(a.id);
  });

  it('deletes a session', () => {
    const s = newSession({ profile: 'default', language: 'sw' });
    expect(deleteSession(s.id)).toBe(true);
    expect(loadSession(s.id)).toBeNull();
  });
});
