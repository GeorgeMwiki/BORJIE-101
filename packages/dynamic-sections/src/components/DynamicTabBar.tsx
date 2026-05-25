/**
 * `<DynamicTabBar>` — mobile-first tab bar with React.lazy
 * orchestration + swipe-nav + hamburger collapse.
 *
 * Responsibilities:
 *   - Filters its `sections` input by visibility predicate (already
 *     done by `useSectionRegistry`, so we trust the caller here).
 *   - Renders only the active section's component, wrapped in
 *     {@link SectionMount} so the chunk is fetched lazily.
 *   - At the `mobile` breakpoint, collapses the tab list behind a
 *     hamburger toggle + supports swipe-left/right on the content
 *     area to navigate between tabs.
 *
 * Keyboard semantics — follows ARIA APG tabs pattern:
 *   - Roving tabindex (only the active tab is focusable from outside).
 *   - Arrow-left / Arrow-right cycle through tabs (wraps).
 *   - Home / End jump to first / last.
 *
 * Accessibility:
 *   - role="tablist" on the tab container, role="tab" on each
 *     trigger, role="tabpanel" on the mount container.
 *   - aria-controls / aria-labelledby linkage.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import type { Section, SectionScope } from '../contracts/section.js';
import { useViewportBreakpoint } from '../hooks/use-viewport-breakpoint.js';
import { useSwipeNav } from '../hooks/use-swipe-nav.js';
import { SectionMount } from './SectionMount.js';

export interface DynamicTabBarProps {
  readonly sections: readonly Section[];
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
  /**
   * Optional controlled key — render this tab as active. If omitted
   * the component manages its own active state.
   */
  readonly activeKey?: string;
  /** Called whenever the user selects a different tab. */
  readonly onChange?: (key: string) => void;
  /**
   * Empty-state fallback. Rendered when zero sections are visible —
   * a first-day tenant with no entities yet, for example.
   */
  readonly emptyState?: ReactNode;
  /** Optional className for the outer container. */
  readonly className?: string;
  /**
   * Disable swipe gestures (e.g. inside an iframe or storybook
   * environment). Defaults to enabled on mobile only.
   */
  readonly disableSwipe?: boolean;
}

const DEFAULT_EMPTY: ReactNode = (
  <div
    data-testid="dynamic-tabbar-empty"
    className="w-full p-8 text-center text-sm text-muted-foreground"
  >
    No sections yet — create entities from chat and tabs will appear here.
  </div>
);

export function DynamicTabBar(props: DynamicTabBarProps): ReactElement {
  const {
    sections,
    tenantId,
    orgId,
    scope,
    activeKey: controlledKey,
    onChange,
    emptyState,
    className,
    disableSwipe,
  } = props;

  const bp = useViewportBreakpoint();
  const isMobile = bp === 'mobile';

  const [uncontrolledKey, setUncontrolledKey] = useState<string | undefined>(
    sections[0]?.key,
  );
  const [hamburgerOpen, setHamburgerOpen] = useState(false);

  // Active key — controlled or uncontrolled.
  const activeKey = controlledKey ?? uncontrolledKey ?? sections[0]?.key;

  // If the active section disappears (e.g. last entity deleted) fall back
  // to the first available section.
  useEffect(() => {
    if (sections.length === 0) return;
    if (activeKey && sections.some((s) => s.key === activeKey)) return;
    const fallback = sections[0]?.key;
    if (fallback) {
      if (controlledKey === undefined) setUncontrolledKey(fallback);
      onChange?.(fallback);
    }
  }, [sections, activeKey, controlledKey, onChange]);

  const activeIndex = useMemo(() => {
    if (!activeKey) return -1;
    return sections.findIndex((s) => s.key === activeKey);
  }, [sections, activeKey]);

  const select = useCallback(
    (key: string) => {
      if (controlledKey === undefined) setUncontrolledKey(key);
      onChange?.(key);
      setHamburgerOpen(false);
    },
    [controlledKey, onChange],
  );

  const goRelative = useCallback(
    (delta: number) => {
      if (sections.length === 0 || activeIndex < 0) return;
      const next =
        (activeIndex + delta + sections.length) % sections.length;
      const target = sections[next];
      if (target) select(target.key);
    },
    [sections, activeIndex, select],
  );

  const { attach: attachSwipeTarget } = useSwipeNav({
    enabled: isMobile && !disableSwipe,
    onSwipeLeft: () => goRelative(+1),
    onSwipeRight: () => goRelative(-1),
  });

  const tabListRef = useRef<HTMLDivElement | null>(null);

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        goRelative(+1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        goRelative(-1);
        break;
      case 'Home': {
        e.preventDefault();
        const first = sections[0];
        if (first) select(first.key);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = sections[sections.length - 1];
        if (last) select(last.key);
        break;
      }
      default:
        break;
    }
  };

  if (sections.length === 0) {
    return <div className={clsx('dynamic-tabbar', className)}>{emptyState ?? DEFAULT_EMPTY}</div>;
  }

  const active = sections.find((s) => s.key === activeKey) ?? sections[0]!;

  return (
    <div
      className={clsx('dynamic-tabbar w-full', className)}
      data-testid="dynamic-tabbar"
      data-breakpoint={bp}
    >
      {isMobile ? (
        <MobileTabHeader
          sections={sections}
          activeKey={active.key}
          hamburgerOpen={hamburgerOpen}
          onToggleHamburger={() => setHamburgerOpen((v) => !v)}
          onSelect={select}
          onTabKeyDown={onTabKeyDown}
        />
      ) : (
        <DesktopTabList
          listRef={tabListRef}
          sections={sections}
          activeKey={active.key}
          onSelect={select}
          onTabKeyDown={onTabKeyDown}
        />
      )}

      <div
        ref={attachSwipeTarget}
        role="tabpanel"
        id={`dynamic-section-panel-${active.key}`}
        aria-labelledby={`dynamic-section-tab-${active.key}`}
        data-testid="dynamic-tabbar-panel"
        className="dynamic-section-panel pt-2 md:pt-4 touch-pan-y"
      >
        <SectionMount
          key={active.key}
          section={active}
          tenantId={tenantId}
          orgId={orgId}
          scope={scope}
        />
      </div>
    </div>
  );
}

/** Desktop horizontal tab list, ARIA tabs pattern. */
const DesktopTabList = ({
  listRef,
  sections,
  activeKey,
  onSelect,
  onTabKeyDown,
}: {
  readonly listRef: React.RefObject<HTMLDivElement | null>;
  readonly sections: readonly Section[];
  readonly activeKey: string;
  readonly onSelect: (key: string) => void;
  readonly onTabKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}): ReactElement => (
  <div
    ref={listRef as unknown as React.RefObject<HTMLDivElement>}
    role="tablist"
    aria-orientation="horizontal"
    data-testid="dynamic-tabbar-list-desktop"
    className="flex flex-row gap-1 border-b border-slate-200 overflow-x-auto"
  >
    {sections.map((s) => {
      const selected = s.key === activeKey;
      return (
        <button
          key={s.key}
          type="button"
          role="tab"
          id={`dynamic-section-tab-${s.key}`}
          aria-selected={selected}
          aria-controls={`dynamic-section-panel-${s.key}`}
          tabIndex={selected ? 0 : -1}
          data-testid={`dynamic-tabbar-trigger-${s.key}`}
          data-active={selected || undefined}
          onClick={() => onSelect(s.key)}
          onKeyDown={onTabKeyDown}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            'whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
            selected
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300',
          )}
        >
          <span data-icon={s.icon} className="dynamic-section-icon" aria-hidden="true" />
          <span>{s.label}</span>
        </button>
      );
    })}
  </div>
);

/** Mobile collapsed header with hamburger toggle. */
function MobileTabHeader({
  sections,
  activeKey,
  hamburgerOpen,
  onToggleHamburger,
  onSelect,
  onTabKeyDown,
}: {
  readonly sections: readonly Section[];
  readonly activeKey: string;
  readonly hamburgerOpen: boolean;
  readonly onToggleHamburger: () => void;
  readonly onSelect: (key: string) => void;
  readonly onTabKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const active = sections.find((s) => s.key === activeKey);
  return (
    <div className="dynamic-tabbar-mobile">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <button
          type="button"
          aria-label={hamburgerOpen ? 'Close section menu' : 'Open section menu'}
          aria-expanded={hamburgerOpen}
          aria-controls="dynamic-tabbar-list-mobile"
          data-testid="dynamic-tabbar-hamburger"
          onClick={onToggleHamburger}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span className="sr-only">Sections</span>
          <span aria-hidden="true">{hamburgerOpen ? '✕' : '☰'}</span>
        </button>
        <div
          data-testid="dynamic-tabbar-current-label"
          className="text-sm font-medium text-slate-700"
        >
          {active?.label ?? 'Section'}
        </div>
        <span className="h-9 w-9" aria-hidden="true" />
      </div>
      {hamburgerOpen && (
        <div
          role="tablist"
          aria-orientation="vertical"
          id="dynamic-tabbar-list-mobile"
          data-testid="dynamic-tabbar-list-mobile"
          className="flex flex-col gap-0.5 border-b border-slate-200 bg-white"
        >
          {sections.map((s) => {
            const selected = s.key === activeKey;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                id={`dynamic-section-tab-${s.key}`}
                aria-selected={selected}
                aria-controls={`dynamic-section-panel-${s.key}`}
                tabIndex={selected ? 0 : -1}
                data-testid={`dynamic-tabbar-trigger-${s.key}`}
                data-active={selected || undefined}
                onClick={() => onSelect(s.key)}
                onKeyDown={onTabKeyDown}
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  selected
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span data-icon={s.icon} className="dynamic-section-icon" aria-hidden="true" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
