# Realtime Rooms Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/realtime-rooms/`
**Public entry:** `packages/realtime-rooms/src/index.ts`
**Tier scope:** user surface (Yjs collaboration substrate)

## Purpose

The collaboration substrate behind chat-ui blackboards, shared
notes, and brain-peer streaming. Built on **Yjs** CRDTs so multiple
users + the Brain can edit the same document concurrently. Provides
a typed client (`client.ts`), the brain-as-peer adapter
(`brain-peer.ts`), and the Yjs document helper (`yjs-doc.ts`).

## Entry points

- `src/index.ts` — barrel.
- `src/client.ts` — `RealtimeClient` (connect, join, publish).
- `src/brain-peer.ts` — `BrainPeer` (Brain participates as Yjs peer).
- `src/yjs-doc.ts` — Yjs document factory + typed shape helpers.

## Internal structure

- `client.ts` — WebSocket + reconnect logic.
- `brain-peer.ts` — Yjs awareness + room policy enforcement.
- `yjs-doc.ts` — Yjs `Y.Doc` wrapper.
- `__tests__/` — concurrency + reconnect tests.

## Dependencies

- Upstream: yjs, y-websocket, `@borjie/observability`,
  `@borjie/authz-policy`.
- Downstream: chat-ui (blackboard + dopamine), central-intelligence
  (brain-peer).

## Common workflows

- **Join a room** → `client.join(roomId, { tenantId, userId })`.
- **Mutate** → `doc.transact(() => ymap.set('k', v))`.
- **Brain joins** → `brainPeer.connect({ room, capabilities })`.
- **Listen for changes** → `doc.on('update', cb)`.

## Anti-patterns to avoid

- Never join a room without verifying tenant scope.
- Never mutate outside `doc.transact()` (breaks CRDT properties).
- Never persist Y.Doc state without snapshot rotation.
- Never give the Brain write access beyond its agreed scope.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — primary consumer
- [central-intelligence.md](./central-intelligence.md) — brain peer
- [observability.md](./observability.md) — room metrics
