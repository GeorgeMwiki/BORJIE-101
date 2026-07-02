/**
 * ErrorState — accessible failure panel (LitFin polish bar).
 *
 * A centred column with a tinted danger icon, a title, an optional
 * description, and a retry / secondary action row. Distinct from `Empty`
 * (which is a benign zero-state): this surface signals that something
 * WENT WRONG and is announced assertively.
 *
 * A11y:
 *   - The panel is `role="alert"` so screen readers announce the failure
 *     immediately when it mounts (an error is time-sensitive, unlike the
 *     polite `role="status"` of an empty state).
 *   - The icon is `aria-hidden`; meaning comes from the text.
 *   - Actions are real buttons with focus-visible rings (inherited from
 *     Button) meeting WCAG 2.2 target-size.
 *
 * Copy: EVERY user-facing string (title, description, action labels) is
 * caller-supplied and already localized. This file ships zero hardcoded
 * strings — the danger tint + icon carry the semantic, the caller carries
 * the words (zero-mix canon).
 *
 *   <ErrorState
 *     title={t('errors.loadFailed.title')}
 *     description={t('errors.loadFailed.body')}
 *     action={{ label: t('common.retry'), onClick: refetch }}
 *   />
 */
import * as React from 'react';
import { AlertTriangle, WifiOff, ShieldAlert, ServerCrash } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';

type ErrorStateTone = 'error' | 'offline' | 'forbidden' | 'server';

export interface ErrorStateAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ErrorStateProps {
  /** Localized headline describing the failure. */
  readonly title: string;
  /** Optional localized detail / recovery guidance. */
  readonly description?: string;
  /** Primary recovery action (usually retry). */
  readonly action?: ErrorStateAction;
  /** Optional secondary action (e.g. go back, contact support). */
  readonly secondaryAction?: ErrorStateAction;
  /** Custom icon overriding the tone default. */
  readonly icon?: React.ReactNode;
  /** Visual tone + default icon. */
  readonly tone?: ErrorStateTone;
  /** Compact inline layout (smaller icon, tighter padding). */
  readonly compact?: boolean;
  readonly className?: string;
  /** Extra content below the actions (e.g. a support link). */
  readonly footer?: React.ReactNode;
}

const toneIcons: Record<ErrorStateTone, React.ComponentType<{ className?: string }>> = {
  error: AlertTriangle,
  offline: WifiOff,
  forbidden: ShieldAlert,
  server: ServerCrash,
};

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  description,
  action,
  secondaryAction,
  icon,
  tone = 'error',
  compact = false,
  className,
  footer,
}) => {
  const ToneIcon = toneIcons[tone] ?? AlertTriangle;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6' : 'py-12',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center rounded-full bg-destructive/10 text-destructive',
          compact ? 'h-12 w-12' : 'h-16 w-16',
        )}
      >
        {icon ?? <ToneIcon className={compact ? 'h-5 w-5' : 'h-7 w-7'} />}
      </div>
      <h3
        className={cn(
          'font-display font-medium tracking-tight text-foreground',
          compact ? 'mt-3 text-sm' : 'mt-5 text-base',
        )}
      >
        {title}
      </h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action ? (
            <Button onClick={action.onClick}>{action.label}</Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
      {footer ? (
        <div className="mt-6 text-xs text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
};
