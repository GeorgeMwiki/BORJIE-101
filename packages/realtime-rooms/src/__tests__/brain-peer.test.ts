/**
 * brain-peer.ts tests — brain attaches as room peer, broadcasts events,
 * emits gen-ui parts via the kernel handle.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { createBrainPeer, type BrainKernelHandle } from '../brain-peer.js';
import type { LiveblocksRoom } from '../client.js';

function mockRoom(): LiveblocksRoom & { broadcastEvent: Mock; leave: Mock } {
  const broadcastEvent = vi.fn();
  const leave = vi.fn();
  const client = { broadcastEvent, leave };
  return {
    roomId: 'borjie:lease-editing:tnt-1:lease-42',
    client: client as unknown as LiveblocksRoom['client'],
    disconnect: leave,
    broadcastEvent,
    leave,
  };
}

function mockKernel(tenantId = 'tnt-1'): BrainKernelHandle & {
  emitGenUIPart: Mock;
} {
  const emitGenUIPart = vi.fn(async () => undefined);
  return {
    tenantId,
    emitGenUIPart,
  };
}

describe('createBrainPeer', () => {
  let room: ReturnType<typeof mockRoom>;
  let kernel: ReturnType<typeof mockKernel>;

  beforeEach(() => {
    room = mockRoom();
    kernel = mockKernel();
  });

  it('rejects a non-brain persona role', () => {
    expect(() =>
      createBrainPeer({
        room,
        kernel,
        persona: {
          id: 'brain-1',
          displayName: 'Brain',
          role: 'human' as never,
        },
      }),
    ).toThrow(/persona\.role must be "brain"/);
  });

  it('rejects a missing kernel.tenantId', () => {
    expect(() =>
      createBrainPeer({
        room,
        kernel: { tenantId: '', emitGenUIPart: vi.fn() } as never,
        persona: { id: 'b1', displayName: 'B', role: 'brain' },
      }),
    ).toThrow(/kernel\.tenantId/);
  });

  it('attaches and exposes persona + roomId', () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    expect(peer.persona.id).toBe('brain-1');
    expect(peer.roomId).toBe(room.roomId);
  });

  it('broadcasts a typed customEvent', () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    const ok = peer.broadcast({
      kind: 'chat-message',
      payload: { text: 'hi' },
      emittedAt: new Date().toISOString(),
    });
    expect(ok).toBe(true);
    expect(room.broadcastEvent).toHaveBeenCalledWith(
      room.roomId,
      expect.objectContaining({ kind: 'chat-message' }),
    );
  });

  it('sendGenUIPart routes through kernel.emitGenUIPart and broadcasts', async () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    await peer.sendGenUIPart('LeaseOptionCard', { leaseId: 'l-1' });
    expect(kernel.emitGenUIPart).toHaveBeenCalledWith({
      roomId: room.roomId,
      partKind: 'LeaseOptionCard',
      payload: { leaseId: 'l-1' },
    });
    expect(room.broadcastEvent).toHaveBeenCalledWith(
      room.roomId,
      expect.objectContaining({
        kind: 'gen-ui-part',
        payload: expect.objectContaining({ partKind: 'LeaseOptionCard' }),
      }),
    );
  });

  it('detach is idempotent and leaves the room', () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    peer.detach();
    peer.detach();
    expect(room.leave).toHaveBeenCalledTimes(1);
  });

  it('broadcast after detach returns false', () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    peer.detach();
    const ok = peer.broadcast({
      kind: 'chat-message',
      payload: {},
      emittedAt: new Date().toISOString(),
    });
    expect(ok).toBe(false);
  });

  it('sendGenUIPart after detach throws', async () => {
    const peer = createBrainPeer({
      room,
      kernel,
      persona: { id: 'brain-1', displayName: 'Brain', role: 'brain' },
    });
    peer.detach();
    await expect(
      peer.sendGenUIPart('X', {}),
    ).rejects.toThrow(/after detach/);
  });
});
