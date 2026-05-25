/**
 * @borjie/browser-perception
 *
 * Browser-Use AXTree perception for legacy vendor portals. Use this
 * package whenever the brain needs to "see" a third-party web surface
 * that has no API — KRA iTax, GePG, etc. The a11y tree is the
 * perception substrate; raw DOM is never fed to the LLM.
 *
 * Caps (token-cheap by default): depth ≤ 12, ≤ 200 nodes per snapshot.
 *
 * Central Command Phase B B6 — see `.planning/central-command/00-architecture.md`.
 */

export {
  captureAxTreeSnapshot,
  flattenAxNodes,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
} from './axtree-snapshot.js';
export type {
  AxNode,
  AxTreeSnapshot,
  RawAxNode,
  PlaywrightPageLike,
  SnapshotOptions,
} from './axtree-snapshot.js';

export {
  diffAxSnapshots,
  diffSize,
  diffContainsAdded,
} from './axtree-diff.js';
export type {
  AxTreeDiff,
  AxDiffEntry,
  AxChangedEntry,
} from './axtree-diff.js';

export { LegacyPortalDriver } from './legacy-portal-driver.js';
export type {
  LegacyPortalDriverOptions,
  DrivablePage,
  LocatorLike,
  LegacyPortalAction,
  ActionResult,
  PortalCredentials,
} from './legacy-portal-driver.js';
