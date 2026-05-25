import * as React from 'react';
import { cn } from '../../lib/utils';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, description, actions, breadcrumbs, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('mb-8', className)} {...props}>
        {breadcrumbs && <div className="mb-4">{breadcrumbs}</div>}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
      </div>
    );
  }
);
PageHeader.displayName = 'PageHeader';

export { PageHeader };
