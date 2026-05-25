/**
 * client.ts tests — room-id contract + Liveblocks client factory.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildRoomId,
  parseRoomId,
  isCanonicalRoomId,
  createLiveblocksRoom,
  configureLiveblocksFactory,
  __resetLiveblocksFactory,
} from '../client.js';

describe('buildRoomId', () => {
  it('builds a canonical lease-editing room id', () => {
    expect(buildRoomId('lease-editing', 'tnt-1', 'lease-42')).toBe(
      'borjie:lease-editing:tnt-1:lease-42',
    );
  });

  it('builds a canonical maintenance-thread room id', () => {
    expect(buildRoomId('maintenance-thread', 'tnt-9', 'tkt-77')).toBe(
      'borjie:maintenance-thread:tnt-9:tkt-77',
    );
  });

  it('rejects an unknown room kind', () => {
    expect(() =>
      buildRoomId('not-a-kind' as never, 'tnt-1', 'r'),
    ).toThrow(/unknown room kind/);
  });

  it('rejects a tenantId with a colon (token-bypass guard)', () => {
    expect(() =>
      buildRoomId('lease-editing', 'tnt:evil', 'lease-1'),
    ).toThrow(/tenantId/);
  });

  it('rejects a resourceId with a colon', () => {
    expect(() =>
      buildRoomId('lease-editing', 'tnt-1', 'lease:evil'),
    ).toThrow(/resourceId/);
  });
});

describe('isCanonicalRoomId / parseRoomId', () => {
  it('accepts a canonical id', () => {
    const id = 'borjie:lease-editing:tnt-1:lease-42';
    expect(isCanonicalRoomId(id)).toBe(true);
    expect(parseRoomId(id)).toEqual({
      kind: 'lease-editing',
      tenantId: 'tnt-1',
      resourceId: 'lease-42',
    });
  });

  it('rejects an unprefixed id', () => {
    expect(isCanonicalRoomId('lease-editing:tnt-1:lease-42')).toBe(false);
    expect(parseRoomId('lease-editing:tnt-1:lease-42')).toBeNull();
  });

  it('rejects a fabricated kind', () => {
    expect(
      isCanonicalRoomId('borjie:billing:tnt-1:lease-42'),
    ).toBe(false);
  });
});

describe('createLiveblocksRoom', () => {
  beforeEach(() => {
    __resetLiveblocksFactory();
  });

  it('throws when no factory is configured', () => {
    expect(() =>
      createLiveblocksRoom({
        roomId: 'borjie:lease-editing:tnt-1:lease-42',
        authEndpoint: '/api/v1/realtime/auth',
        userInfo: { id: 'u1', tenantId: 'tnt-1', displayName: 'U' },
      }),
    ).toThrow(/no Liveblocks factory configured/);
  });

  it('throws on a non-canonical room id', () => {
    configureLiveblocksFactory(() => ({
      enterRoom: vi.fn(),
      leave: vi.fn(),
    }));
    expect(() =>
      createLiveblocksRoom({
        roomId: 'lease-editing:tnt-1:lease-42',
        authEndpoint: '/api/v1/realtime/auth',
        userInfo: { id: 'u1', tenantId: 'tnt-1', displayName: 'U' },
      }),
    ).toThrow(/canonical pattern/);
  });

  it('throws when userInfo lacks tenantId', () => {
    configureLiveblocksFactory(() => ({
      enterRoom: vi.fn(),
      leave: vi.fn(),
    }));
    expect(() =>
      createLiveblocksRoom({
        roomId: 'borjie:lease-editing:tnt-1:lease-42',
        authEndpoint: '/api/v1/realtime/auth',
        userInfo: { id: 'u1', tenantId: '', displayName: 'U' },
      }),
    ).toThrow(/userInfo\.id and userInfo\.tenantId/);
  });

  it('happy path: invokes factory, enters room, returns disconnect', () => {
    const enterRoom = vi.fn();
    const leave = vi.fn();
    const factory = vi.fn(() => ({ enterRoom, leave }));
    configureLiveblocksFactory(factory);

    const room = createLiveblocksRoom({
      roomId: 'borjie:lease-editing:tnt-1:lease-42',
      authEndpoint: '/api/v1/realtime/auth',
      userInfo: { id: 'u1', tenantId: 'tnt-1', displayName: 'U' },
    });

    expect(factory).toHaveBeenCalledWith({
      authEndpoint: '/api/v1/realtime/auth',
    });
    expect(enterRoom).toHaveBeenCalledWith(
      'borjie:lease-editing:tnt-1:lease-42',
      { userInfo: { id: 'u1', tenantId: 'tnt-1', displayName: 'U' } },
    );
    expect(room.roomId).toBe('borjie:lease-editing:tnt-1:lease-42');

    room.disconnect();
    expect(leave).toHaveBeenCalledWith(
      'borjie:lease-editing:tnt-1:lease-42',
    );
  });
});
