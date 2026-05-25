import * as React from 'react';
import { cn } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../Card';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    label?: string;
  };
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, description, icon, trend, ...props }, ref) => {
    const trendColor = trend
      ? trend.value >= 0
        ? 'text-success'
        : 'text-danger'
      : '';

    return (
      <Card ref={ref} className={cn(className)} {...props}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {(description || trend) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {trend && (
                <span className={cn('font-medium', trendColor)}>
                  {trend.value >= 0 ? '+' : ''}
                  {trend.value}%
                  {trend.label && ` ${trend.label}`}
                </span>
              )}
              {trend && description && ' '}
              {description}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }
);
StatCard.displayName = 'StatCard';

export { StatCard };
