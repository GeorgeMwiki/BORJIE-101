/**
 * `@borjie/mcp/mount-registry` — the mount-everything subsystem.
 *
 * Two primitives:
 *   - `createMountRegistry` — declare every Borjie/BN service mountable as an
 *     MCP server the one MD owns; mount lazily, bound to a tenant scope.
 *   - `createProgressiveDisclosure` — the tools-as-/proc-filesystem loader so
 *     50+ juniors do not blow the context window (list names cheaply, page in
 *     specs only for the subset a turn needs).
 */

export {
  createMountRegistry,
  type MountRegistry,
  type MountableServer,
  type MountedServer,
  type MountProject,
  type MountKind,
} from './mount-registry.js';

export {
  createProgressiveDisclosure,
  disclosurePath,
  splitDisclosurePath,
  type ProgressiveDisclosure,
  type DisclosurePathEntry,
  type DisclosedToolSpec,
  type OrganSummary,
} from './progressive-disclosure.js';
