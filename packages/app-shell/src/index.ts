/**
 * @borjie/app-shell
 *
 * Shared application shell that unifies the Borjie owner-web (Owner Cockpit,
 * port 3010) and admin-web (Borjie Console, port 3020) surfaces into one
 * product. Exposes a thin top bar with a cross-portal switcher.
 *
 * Locale policy: this package hard-codes NO Swahili. Every visible string is
 * injected by the consumer via the `labels` prop (English defaults provided),
 * so the repo's locale-purity guard stays green and EN/SW never mix.
 */

// Portal switcher — compact, accessible cross-origin menu.
export { PortalSwitcher, DEFAULT_PORTAL_LABELS } from './PortalSwitcher.js';
export type {
  PortalSwitcherProps,
  PortalSwitcherLabels,
  PortalKey,
} from './PortalSwitcher.js';

// Top bar — three-slot suite-wide header wrapping the PortalSwitcher.
export { AppTopBar } from './AppTopBar.js';
export type { AppTopBarProps } from './AppTopBar.js';

// Generative surface mount — the suite-wide seam that mounts an MD-authored
// surface (incremental-patched PortalTab body OR a CSP-isolated sandboxed
// iframe for genuinely novel surfaces). The MD "redesigns its own body" here.
export { GenerativeSurfaceMount } from './GenerativeSurfaceMount.js';
export type {
  GenerativeSurfaceMountProps,
  GenerativeSurfaceDescriptor,
  PortalTabSurfaceDescriptor,
  SandboxedSurfaceDescriptor,
} from './GenerativeSurfaceMount.js';
