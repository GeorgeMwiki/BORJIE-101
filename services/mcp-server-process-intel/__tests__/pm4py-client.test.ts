import { describe, it, expect, afterEach } from 'vitest';
import { createMockSidecar } from './test-helpers.js';
import { Pm4pySidecarError } from '../src/types.js';

describe('Pm4pyClient', () => {
  let sidecar: ReturnType<typeof createMockSidecar> | null = null;

  afterEach(async () => {
    if (sidecar) {
      await sidecar.client.close();
      sidecar = null;
    }
  });

  it('round-trips a JSON-line command and returns the response', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: true,
      data: { processes: [{ processId: 'p1' }] },
    }));

    const response = await sidecar.client.send('get_processes', {
      tenantId: 't1',
    });

    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ processes: [{ processId: 'p1' }] });
    expect(sidecar.commandsSeen).toHaveLength(1);
    expect(sidecar.commandsSeen[0]?.kind).toBe('get_processes');
    expect(sidecar.commandsSeen[0]?.args).toEqual({ tenantId: 't1' });
  });

  it('matches responses to requests by id (multiplexing)', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder(async (cmd) => {
      // Reverse the order: respond to the second command first.
      const delay = cmd.kind === 'get_processes' ? 80 : 10;
      await new Promise((r) => setTimeout(r, delay));
      return { id: cmd.id, ok: true, data: { kind: cmd.kind } };
    });

    const [first, second] = await Promise.all([
      sidecar.client.send('get_processes', { tenantId: 't1' }),
      sidecar.client.send('get_bottleneck_analysis', {
        tenantId: 't1',
        processId: 'p1',
      }),
    ]);

    expect(first.ok).toBe(true);
    expect((first.data as { kind: string }).kind).toBe('get_processes');
    expect(second.ok).toBe(true);
    expect((second.data as { kind: string }).kind).toBe(
      'get_bottleneck_analysis',
    );
  });

  it('surfaces structured error responses without throwing', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder((cmd) => ({
      id: cmd.id,
      ok: false,
      error: 'no events found',
      errorCode: 'EMPTY_LOG',
    }));

    const response = await sidecar.client.send('get_conformance', {
      tenantId: 't1',
      processId: 'p1',
    });

    expect(response.ok).toBe(false);
    expect(response.errorCode).toBe('EMPTY_LOG');
    expect(response.error).toBe('no events found');
  });

  it('rejects pending requests when the sidecar exits', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder(
      async (cmd) =>
        new Promise(() => {
          // Never resolves — we want to test the exit path
          void cmd;
        }),
    );

    const inflight = sidecar.client.send('get_processes', { tenantId: 't1' });
    // Give the sidecar a tick to receive the command before killing it.
    await new Promise((r) => setTimeout(r, 30));
    sidecar.killChild(1);

    await expect(inflight).rejects.toThrow(Pm4pySidecarError);
  });

  it('honours the request timeout', async () => {
    sidecar = createMockSidecar();
    sidecar.setResponder(
      () => new Promise(() => { /* never resolves */ }),
    );

    const inflight = sidecar.client.send('get_processes', { tenantId: 't1' });
    await expect(inflight).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('refuses to send after close()', async () => {
    sidecar = createMockSidecar();
    await sidecar.client.close();
    await expect(
      sidecar.client.send('get_processes', { tenantId: 't1' }),
    ).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
  });
});
