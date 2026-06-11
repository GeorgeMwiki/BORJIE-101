/**
 * portal-genui `/tabs/subscribe` — decoupled chat→tab live-linkage channel.
 *
 * Proves the dedicated cross-device tab channel:
 *   1. is auth-gated (401 without a token);
 *   2. delivers a `cockpit.tab.spawned` bus event to the matched user as a
 *      `tab_spawn` SSE frame — INDEPENDENTLY of any chat stream;
 *   3. USER-scopes: a same-tenant DIFFERENT-user event is NOT delivered;
 *   4. echo-filters the caller's OWN device (originDeviceId === ?deviceId).
 *
 * The channel reuses the existing cockpit event bus (NOT a parallel
 * transport), so we drive it by publishing through `publishCockpitEvent`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import portalGenUIRouter from '../portal-genui/portal-genui.router.js';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import {
  publishCockpitEvent,
  __resetCockpitBusForTests,
} from '../../services/cockpit-events/index.js';

function bareApp(): Hono {
  const app = new Hono();
  app.route('/portal-genui', portalGenUIRouter);
  return app;
}

function bearer(opts: { userId?: string; tenantId?: string } = {}): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'owner-1',
    tenantId: opts.tenantId ?? 'tenant-1',
    role: UserRole.SUPER_ADMIN as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Open the SSE stream, read frames until `predicate` is satisfied or the
 * deadline passes, then abort. Returns the accumulated raw SSE text.
 */
async function collectFrames(
  app: Hono,
  path: string,
  token: string,
  opts: {
    readonly publish: () => void;
    readonly until: (text: string) => boolean;
    readonly timeoutMs?: number;
  },
): Promise<string> {
  const controller = new AbortController();
  const res = await app.request(path, {
    headers: { authorization: token },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';

  // Read the opening `connected` frame first so the subscription is live
  // BEFORE we publish — otherwise the event races ahead of the listener.
  const first = await reader.read();
  if (first.value) text += decoder.decode(first.value, { stream: true });

  // The `connected` frame is written BEFORE the route calls
  // `subscribeCockpitEvents`, so reading it does not guarantee the listener
  // is registered yet. Yield a few macrotask turns so the streamSSE
  // callback reaches the subscribe call before we publish.
  await new Promise((r) => setTimeout(r, 30));

  opts.publish();

  // Sequential reads (never two concurrent `read()` on one reader — that
  // orphans the pending chunk). Each read is bounded by an overall
  // deadline-derived timeout so a frame that never arrives (the negative
  // cases) does not hang the test. We DON'T abort between reads so a
  // published frame still has time to flush through the queue microtask.
  const deadline = Date.now() + (opts.timeoutMs ?? 1_000);
  while (Date.now() < deadline && !opts.until(text)) {
    const remaining = Math.max(50, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), remaining);
    });
    const result = await Promise.race([reader.read(), timed]);
    if (timer) clearTimeout(timer);
    if (result === 'timeout') break;
    if (result.value) text += decoder.decode(result.value, { stream: true });
    if (result.done) break;
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  return text;
}

const SPAWN_BASE = {
  kind: 'cockpit.tab.spawned' as const,
  tenantId: 'tenant-1',
  tabId: 'finance|focus:gold',
  tabType: 'finance',
  title: 'Gold Quarter',
  config: { mineralKind: 'gold' },
  source: 'brain' as const,
};

describe('portal-genui /tabs/subscribe — auth', () => {
  beforeEach(() => __resetCockpitBusForTests());

  it('rejects without a token', async () => {
    const res = await bareApp().request('/portal-genui/tabs/subscribe');
    expect(res.status).toBe(401);
  });
});

describe('portal-genui /tabs/subscribe — delivery', () => {
  beforeEach(() => __resetCockpitBusForTests());

  it('delivers the owner\'s tab.spawned as a tab_spawn frame', async () => {
    const text = await collectFrames(
      bareApp(),
      '/portal-genui/tabs/subscribe',
      bearer({ userId: 'owner-1' }),
      {
        publish: () =>
          publishCockpitEvent({
            ...SPAWN_BASE,
            emittedAt: new Date().toISOString(),
            userId: 'owner-1',
            originDeviceId: 'device-A',
          }),
        until: (t) => t.includes('event: tab_spawn'),
      },
    );
    expect(text).toContain('event: tab_spawn');
    expect(text).toContain('Gold Quarter');
  });

  it('does NOT deliver a different user\'s event (user-scoped)', async () => {
    const text = await collectFrames(
      bareApp(),
      '/portal-genui/tabs/subscribe',
      bearer({ userId: 'owner-1' }),
      {
        publish: () =>
          publishCockpitEvent({
            ...SPAWN_BASE,
            emittedAt: new Date().toISOString(),
            userId: 'OTHER-USER',
            originDeviceId: 'device-Z',
          }),
        until: (t) => t.includes('event: tab_spawn'),
        timeoutMs: 400,
      },
    );
    expect(text).not.toContain('event: tab_spawn');
  });

  it('echo-filters the caller\'s own device', async () => {
    const text = await collectFrames(
      bareApp(),
      '/portal-genui/tabs/subscribe?deviceId=device-A',
      bearer({ userId: 'owner-1' }),
      {
        publish: () =>
          publishCockpitEvent({
            ...SPAWN_BASE,
            emittedAt: new Date().toISOString(),
            userId: 'owner-1',
            originDeviceId: 'device-A', // SAME as ?deviceId — must be skipped
          }),
        until: (t) => t.includes('event: tab_spawn'),
        timeoutMs: 400,
      },
    );
    expect(text).not.toContain('event: tab_spawn');
  });
});
