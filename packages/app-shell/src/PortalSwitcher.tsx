import * as React from 'react';

/**
 * The two product surfaces that make up the Borjie suite. `owner` is the
 * mining owner's strategic cockpit (owner-web, port 3010); `admin` is the
 * Borjie team's internal console (admin-web, port 3020).
 */
export type PortalKey = 'owner' | 'admin';

/**
 * Localized, consumer-supplied labels. NOTHING here is hard-coded in this
 * package — the consuming app owns the active locale (en | sw) and passes the
 * matching strings. This keeps the repo locale-purity guard happy: zero
 * Swahili lives in app-shell; the consumer injects `sw` copy when the active
 * locale is `sw`, and `en` copy otherwise. There is never any mixing.
 *
 * Expected keys:
 * - `owner`  — visible name of the Owner Cockpit portal (e.g. EN "Owner Cockpit").
 * - `admin`  — visible name of the Borjie Console portal (e.g. EN "Borjie Console").
 * - `switch` — accessible action label for the trigger / menu, announced to
 *              screen readers (e.g. EN "Switch portal"). Used as the menu's
 *              `aria-label` and the trigger's accessible description.
 */
export interface PortalSwitcherLabels {
  owner: string;
  admin: string;
  switch: string;
}

/** English defaults. Consumers MUST override with `sw` copy when locale=sw. */
export const DEFAULT_PORTAL_LABELS: PortalSwitcherLabels = {
  owner: 'Owner Cockpit',
  admin: 'Borjie Console',
  switch: 'Switch portal',
};

export interface PortalSwitcherProps {
  /** Which portal the user is currently on. Highlighted + `aria-current`. */
  current: PortalKey;
  /** Absolute, cross-origin URL of the Owner Cockpit (owner-web). */
  ownerUrl: string;
  /** Absolute, cross-origin URL of the Borjie Console (admin-web). */
  adminUrl: string;
  /** Localized strings supplied by the consumer. Defaults are English. */
  labels?: PortalSwitcherLabels;
  /** Optional extra class on the root `<details>` for layout composition. */
  className?: string;
}

interface PortalEntry {
  key: PortalKey;
  label: string;
  href: string;
}

const buildEntries = (
  ownerUrl: string,
  adminUrl: string,
  labels: PortalSwitcherLabels,
): readonly [PortalEntry, PortalEntry] => [
  { key: 'owner', label: labels.owner, href: ownerUrl },
  { key: 'admin', label: labels.admin, href: adminUrl },
];

/**
 * Compact, accessible portal switcher. Built on native `<details>`/`<summary>`
 * so it is keyboard-operable with zero JS (Enter / Space toggles the trigger,
 * Tab moves through items, Enter activates a link). Cross-origin navigation is
 * a plain anchor `href`, so middle-click / open-in-new-tab work naturally and
 * no `window.location` scripting is required for the common path.
 *
 * The `current` portal is rendered as a non-interactive, highlighted marker
 * carrying `aria-current="page"`; the other portal is an anchor to its
 * absolute URL.
 */
export const PortalSwitcher: React.FC<PortalSwitcherProps> = ({
  current,
  ownerUrl,
  adminUrl,
  labels = DEFAULT_PORTAL_LABELS,
  className,
}) => {
  const detailsRef = React.useRef<HTMLDetailsElement>(null);
  const entries = buildEntries(ownerUrl, adminUrl, labels);
  const currentEntry = entries.find((e) => e.key === current) ?? entries[0];

  const close = React.useCallback(() => {
    const el = detailsRef.current;
    if (el && el.open) {
      el.open = false;
    }
  }, []);

  // Close on Escape and on outside click — standard menu affordances.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const el = detailsRef.current;
      if (el && el.open && event.target instanceof Node && !el.contains(event.target)) {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [close]);

  const rootClassName = ['borjie-portal-switcher', className].filter(Boolean).join(' ');

  return (
    <details ref={detailsRef} className={rootClassName} data-current={current}>
      <summary
        className="borjie-portal-switcher__trigger"
        aria-label={labels.switch}
        aria-haspopup="menu"
      >
        <span className="borjie-portal-switcher__trigger-label">{currentEntry.label}</span>
        <span className="borjie-portal-switcher__chevron" aria-hidden="true">
          {'▾'}
        </span>
      </summary>
      <div
        role="menu"
        aria-label={labels.switch}
        aria-orientation="vertical"
        className="borjie-portal-switcher__menu"
      >
        {entries.map((entry) =>
          entry.key === current ? (
            <span
              key={entry.key}
              role="menuitem"
              aria-current="page"
              aria-disabled="true"
              tabIndex={-1}
              className="borjie-portal-switcher__item borjie-portal-switcher__item--current"
            >
              {entry.label}
            </span>
          ) : (
            <a
              key={entry.key}
              role="menuitem"
              href={entry.href}
              onClick={close}
              className="borjie-portal-switcher__item"
            >
              {entry.label}
            </a>
          ),
        )}
      </div>
    </details>
  );
};

PortalSwitcher.displayName = 'PortalSwitcher';
