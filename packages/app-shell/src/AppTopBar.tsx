import * as React from 'react';
import { PortalSwitcher, type PortalSwitcherProps } from './PortalSwitcher.js';

/**
 * Thin, suite-wide top bar shared by owner-web and admin-web so the two
 * surfaces read as one product. Layout is a three-slot row:
 *
 *   [ brand ]            [ PortalSwitcher (center) ]            [ actions ]
 *
 * The bar is deliberately logic-free beyond the portal switcher. It bakes in
 * NO locale, theme, or user logic: the consumer passes those as React nodes in
 * the `actions` slot (e.g. a locale toggle, a theme toggle, an avatar menu),
 * and supplies the already-localized `labels` for the switcher. This keeps the
 * package locale-pure (no Swahili strings live here) and unopinionated.
 */
export interface AppTopBarProps
  extends Pick<PortalSwitcherProps, 'current' | 'ownerUrl' | 'adminUrl' | 'labels'> {
  /** Left slot — typically the Borjie logomark / wordmark, optionally linked. */
  brand?: React.ReactNode;
  /** Right slot — consumer-owned controls (locale, theme, user menu, …). */
  actions?: React.ReactNode;
  /** Optional extra class on the `<header>` root for layout composition. */
  className?: string;
}

export const AppTopBar: React.FC<AppTopBarProps> = ({
  brand,
  actions,
  current,
  ownerUrl,
  adminUrl,
  labels,
  className,
}) => {
  const rootClassName = ['borjie-app-top-bar', className].filter(Boolean).join(' ');

  return (
    <header className={rootClassName}>
      <div className="borjie-app-top-bar__brand">{brand}</div>
      <div className="borjie-app-top-bar__center">
        <PortalSwitcher
          current={current}
          ownerUrl={ownerUrl}
          adminUrl={adminUrl}
          {...(labels ? { labels } : {})}
        />
      </div>
      <div className="borjie-app-top-bar__actions">{actions}</div>
    </header>
  );
};

AppTopBar.displayName = 'AppTopBar';
