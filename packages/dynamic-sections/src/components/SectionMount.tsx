/**
 * `<SectionMount>` — deferred-data-mount wrapper.
 *
 * Vision: a section's component (and any data slice it owns) must
 * NOT run until the section's tab is actually selected. This keeps
 * mobile bundles tiny + initial network payload small. As soon as
 * the tab is selected, we resolve the section's `component_loader`
 * inside React.lazy + Suspense, render a skeleton while the chunk
 * arrives, then mount the component which is free to kick off its
 * own queries.
 *
 * Re-mount semantics:
 *   - Once a section has been mounted, we KEEP its module memoised
 *     so re-selection is instant (zero waterfall). The host
 *     component itself may unmount its tree when the tab is
 *     deselected (`keepAlive={false}`) — useful for memory
 *     pressure on long-running sessions.
 */

import {
  Suspense,
  lazy,
  useMemo,
  type LazyExoticComponent,
  type ReactElement,
} from 'react';
import type {
  ComponentModule,
  Section,
  SectionComponentProps,
  SectionScope,
} from '../contracts/section.js';
import { SectionSkeleton } from './SectionSkeleton.js';

export interface SectionMountProps {
  readonly section: Section;
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
  /** Custom fallback element. Defaults to {@link SectionSkeleton}. */
  readonly fallback?: ReactElement;
  /**
   * If false, the section's component is unmounted whenever the
   * parent decides the tab is inactive. Default is the parent's
   * responsibility — `SectionMount` itself does not gate by selection.
   */
  readonly keepAlive?: boolean;
}

/**
 * Cache of lazy components keyed by section key. Ensures we only
 * pay the dynamic-import cost once per section per session.
 */
const lazyCache: Map<string, LazyExoticComponent<React.ComponentType<SectionComponentProps>>> = new Map();

function getLazyComponent(section: Section) {
  let lazyComp = lazyCache.get(section.key);
  if (!lazyComp) {
    lazyComp = lazy(async () => {
      const mod: ComponentModule = await section.component_loader();
      return { default: mod.default };
    });
    lazyCache.set(section.key, lazyComp);
  }
  return lazyComp;
}

/**
 * For tests / hot-reload — clear the lazy-component cache. NOT
 * exported from the package root; tests import directly.
 */
export function __clearLazyCacheForTesting(): void {
  lazyCache.clear();
}

export function SectionMount({
  section,
  tenantId,
  orgId,
  scope,
  fallback,
}: SectionMountProps): ReactElement {
  const LazyComp = useMemo(() => getLazyComponent(section), [section]);
  const fb = fallback ?? <SectionSkeleton sectionLabel={section.label} />;

  return (
    <Suspense fallback={fb}>
      <LazyComp
        tenantId={tenantId}
        orgId={orgId}
        entityType={section.entity_type}
        scope={scope}
      />
    </Suspense>
  );
}
