import * as React from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        aria-label={`Empty state: ${title}`}
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center',
          className
        )}
        {...props}
      >
        {icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && (
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-6">{action}</div>}
      </div>
    );
  }
);
EmptyState.displayName = 'EmptyState';

export { EmptyState };
