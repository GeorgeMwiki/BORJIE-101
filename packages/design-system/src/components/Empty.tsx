/**
 * Empty — LitFin-pattern empty / zero-state surface.
 *
 * Centred column with a tinted-icon container, display-medium title,
 * muted description, and optional CTA below. Used as the body of any
 * panel that has no rows yet (no sites, no licences, no shipments).
 *
 * Copy register: warm and concrete, never accusatory.
 *   Good: "No mining sites yet — add the first to begin."
 *   Bad:  "You have no sites."
 *
 * Variants change the default icon + tint. Caller can always provide
 * a custom `icon` to override.
 *
 *   <Empty
 *     variant="search"
 *     title="No matches"
 *     description="Try a different query or clear filters."
 *     action={{ label: 'Clear search', onClick: clear }}
 *   />
 */
import * as React from 'react';
import {
  Inbox,
  Search,
  FileQuestion,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';

type EmptyVariant = 'default' | 'search' | 'error' | 'folder' | 'success';

export interface EmptyProps {
  readonly icon?: React.ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  /** Optional secondary action rendered next to primary. */
  readonly secondaryAction?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  readonly variant?: EmptyVariant;
  readonly className?: string;
  /** Render extra body content below the action (e.g. trust microcopy). */
  readonly footer?: React.ReactNode;
}

const defaultIcons: Record<EmptyVariant, React.ComponentType<{ className?: string }>> = {
  default: Inbox,
  search: Search,
  error: AlertTriangle,
  folder: FolderOpen,
  success: CheckCircle2,
};

const iconTints: Record<EmptyVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  search: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
  folder: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
};

export const Empty: React.FC<EmptyProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
  className,
  footer,
}) => {
  const DefaultIcon = defaultIcons[variant] ?? FileQuestion;
  const tint = iconTints[variant] ?? iconTints.default;

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-16 w-16 items-center justify-center rounded-full',
          tint,
        )}
        aria-hidden="true"
      >
        {icon || <DefaultIcon className="h-7 w-7" />}
      </div>
      <h3 className="mt-5 font-display text-base font-medium tracking-tight text-foreground">
        {title}
      </h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {(action ?? secondaryAction) ? (
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

export interface EmptySearchProps {
  readonly query: string;
  readonly onClear?: () => void;
  readonly className?: string;
}

export const EmptySearch: React.FC<EmptySearchProps> = ({
  query,
  onClear,
  className,
}) => {
  return (
    <Empty
      variant="search"
      title={`No results for "${query}"`}
      description="Try adjusting your search or clearing filters."
      action={
        onClear
          ? { label: 'Clear search', onClick: onClear }
          : undefined
      }
      className={className}
    />
  );
};
