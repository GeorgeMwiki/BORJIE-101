import { describe, it, expect } from 'vitest';
import {
  createInMemorySessionStore,
  createSessionManager,
} from '../sessions.js';

describe('session manager', () => {
  it('creates a fresh session on first resume', async () => {
    const store = createInMemorySessionStore();
    const mgr = createSessionManager({ store });
    const s = await mgr.resume('sess-1', 'tok-1');
    expect(s.sessionId).toBe('sess-1');
    expect(s.tokenId).toBe('tok-1');
    expect(s.conversationSummary.length).toBe(0);
  });

  it('appends turns up to MAX_TURNS', async () => {
    const store = createInMemorySessionStore();
    const mgr = createSessionManager({ store });
    await mgr.resume('s', 't');
    for (let i = 0; i < 25; i += 1) {
      await mgr.checkpoint('s', {
        direction: 'response',
        method: 'tools/call',
        toolName: 'mining_drafts_list',
        at: i,
        summary: `turn ${i}`,
      });
    }
    const snap = await mgr.snapshot('s');
    expect(snap?.conversationSummary.length).toBe(20);
    expect(snap?.conversationSummary[0]?.summary).toBe('turn 5');
  });

  it('issues a fresh session when the token id differs', async () => {
    const store = createInMemorySessionStore();
    const mgr = createSessionManager({ store });
    await mgr.resume('s', 'tok-a');
    const next = await mgr.resume('s', 'tok-b');
    expect(next.conversationSummary.length).toBe(0);
    expect(next.tokenId).toBe('tok-b');
  });

  it('lets the client push session state', async () => {
    const store = createInMemorySessionStore();
    const mgr = createSessionManager({ store });
    const snap = await mgr.setState('s2', 't', { lastQuery: 'opportunities' });
    expect(snap.state['lastQuery']).toBe('opportunities');
  });

  it('drops the session', async () => {
    const store = createInMemorySessionStore();
    const mgr = createSessionManager({ store });
    await mgr.resume('s', 't');
    await mgr.drop('s');
    expect(await mgr.snapshot('s')).toBeNull();
  });
});
