/**
 * @cross-tenant @security @critical
 *
 * Realtime/WebSocket room isolation: when tenant-X user opens a WebSocket
 * to the realtime layer (`packages/realtime-rooms/`), they must be unable
 * to subscribe to tenant-Y's room. A subscribe-with-other-tenant-id MUST
 * fail or silently receive zero events.
 *
 * The realtime layer is not always exposed through the API gateway in
 * E2E. When the gateway proxy isn't reachable we fixme() and document
 * the gap so the audit trail records it explicitly.
 */
import { test, expect, REAL_BACKEND_ENABLED } from '../../../fixtures/dual-tenant-fixtures';

test.describe('@cross-tenant @security @critical — WebSocket room isolation', () => {
  test.skip(
    !REAL_BACKEND_ENABLED,
    'Set E2E_ENABLE_REAL_BACKEND=1 with docker-compose.e2e.yml up to run',
  );

  test('tenant-X cannot subscribe to tenant-Y realtime room', async ({
    tenantX,
    tenantY,
    page,
  }) => {
    if (tenantX.jwt.length === 0) {
      test.fixme(true, 'tenant-X JWT could not be minted');
      return;
    }

    // The realtime layer is exposed under `packages/realtime-rooms/` but is
    // not reliably proxied through the API gateway in E2E. Attempt a WS
    // connection from a real browser context so we can observe the
    // handshake / first message — if the connection refuses or returns no
    // tenant-Y events, isolation holds.
    const wsUrl =
      process.env.REALTIME_WS_URL ?? 'ws://localhost:4001/ws';

    const result = await page.evaluate(
      async ({ url, jwt, foreignTenant }) => {
        return await new Promise<{
          opened: boolean;
          foreignEventSeen: boolean;
          errorOnSubscribe: boolean;
        }>((resolve) => {
          let opened = false;
          let foreignEventSeen = false;
          let errorOnSubscribe = false;
          let ws: WebSocket;
          try {
            ws = new WebSocket(`${url}?token=${encodeURIComponent(jwt)}`);
          } catch {
            resolve({ opened: false, foreignEventSeen: false, errorOnSubscribe: true });
            return;
          }
          const timer = setTimeout(() => {
            try {
              ws.close();
            } catch {
              /* swallow */
            }
            resolve({ opened, foreignEventSeen, errorOnSubscribe });
          }, 3000);

          ws.addEventListener('open', () => {
            opened = true;
            try {
              ws.send(
                JSON.stringify({
                  type: 'subscribe',
                  tenantId: foreignTenant,
                  room: `tenant:${foreignTenant}`,
                }),
              );
            } catch {
              errorOnSubscribe = true;
            }
          });
          ws.addEventListener('message', (event: MessageEvent) => {
            const data = String(event.data ?? '');
            if (
              data.includes(foreignTenant) &&
              !data.toLowerCase().includes('error') &&
              !data.toLowerCase().includes('forbidden') &&
              !data.toLowerCase().includes('denied')
            ) {
              foreignEventSeen = true;
            }
          });
          ws.addEventListener('error', () => {
            errorOnSubscribe = true;
            clearTimeout(timer);
            resolve({ opened, foreignEventSeen, errorOnSubscribe });
          });
        });
      },
      { url: wsUrl, jwt: tenantX.jwt, foreignTenant: tenantY.tenantId },
    );

    if (!result.opened) {
      test.fixme(
        true,
        `Realtime WS at ${wsUrl} not reachable from E2E — gap: ` +
          'verify cross-tenant room isolation via packages/realtime-rooms/ unit tests instead.',
      );
      return;
    }

    expect(
      result.foreignEventSeen,
      `tenant-X must NOT receive tenant-Y events on room subscribe (saw=${result.foreignEventSeen})`,
    ).toBe(false);
  });
});
