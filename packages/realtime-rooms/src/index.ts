/**
 * @borjie/realtime-rooms
 *
 * Liveblocks 3.0 rooms + Yjs CRDT bindings for collaborative editing
 * surfaces where humans and the brain are first-class peers.
 *
 * Central Command Phase B B6 — see `.planning/central-command/00-architecture.md`
 * for the host architecture.
 */

export {
  buildRoomId,
  parseRoomId,
  isCanonicalRoomId,
  createLiveblocksRoom,
  configureLiveblocksFactory,
  __resetLiveblocksFactory,
} from './client.js';
export type {
  RoomKind,
  CreateLiveblocksRoomOptions,
  LiveblocksRoom,
  LiveblocksClientFactory,
} from './client.js';

export { createBrainPeer } from './brain-peer.js';
export type {
  BrainKernelHandle,
  BrainPersona,
  BrainPeer,
  BrainPeerEvent,
  BrainPeerEventKind,
  CreateBrainPeerOptions,
} from './brain-peer.js';

export {
  createYjsBinding,
  configureYjsProvider,
  __resetYjsProviderFactory,
  useDocumentBindingFactory,
} from './yjs-doc.js';
export type {
  YjsBinding,
  YjsBindingStatus,
  YjsProviderFactory,
  CreateYjsBindingOptions,
  ReactHookShim,
  UseDocumentBindingResult,
} from './yjs-doc.js';
