import type { OwnerOSTabContext } from '@borjie/owner-os-tabs';

/**
 * Every panel component accepts this shape. The shell hydrates context
 * + locale from the persisted tab before rendering.
 */
export interface OwnerOSPanelProps {
  /** Stable tab id (deterministic per context — see buildTabId). */
  readonly tabId: string;
  /** Scoped context the brain (or the "+" menu) spawned this tab with. */
  readonly context: OwnerOSTabContext;
  /** Owner's language preference. */
  readonly locale: 'sw' | 'en';
}
