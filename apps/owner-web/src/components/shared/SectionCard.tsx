/**
 * Reusable section card (CONVERGED onto the DS `Card` family).
 *
 * Replaces the `PlaceholderCard` shape for screens that now hold real
 * content. Title + optional subtitle on the left, action slot on the
 * right (refresh, generate, export). The shell now delegates to `Card`,
 * `CardHeader`, `CardTitle`, and `CardContent` from
 * `@borjie/design-system` so the radius, hairline border, surface, and
 * shadow come from ONE source of truth. The eyebrow-style title
 * presentation (uppercase, tracking-wide, muted) is preserved via the
 * DS `CardTitle` `className` + token utilities.
 *
 * Public API ({ title, subtitle?, actions?, children, className? }) is
 * UNCHANGED — do not alter the call signature; 13 importers depend on it.
 */
import type { ReactNode } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@borjie/design-system';

interface SectionCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader
        bordered
        className="flex-row items-start justify-between gap-3 space-y-0 px-5 py-3"
      >
        <div>
          <CardTitle
            size="sm"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {title}
          </CardTitle>
          {subtitle ? (
            <p className="mt-0.5 text-badge text-muted-foreground/80">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="px-5 py-4 pt-4">{children}</CardContent>
    </Card>
  );
}
