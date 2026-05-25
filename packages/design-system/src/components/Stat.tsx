import * as React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../utils/cn';

export interface StatProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  loading?: boolean;
  className?: string;
}

export const Stat: React.FC<StatProps> = ({
  label,
  value,
  change,
  changeLabel,
  icon,
  trend,
  loading,
  className,
}) => {
  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-success" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-danger" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getTrendColor = () => {
    if (trend === 'up') return 'text-success';
    if (trend === 'down') return 'text-danger';
    return 'text-muted-foreground';
  };

  if (loading) {
    return (
      <div className={cn('animate-pulse', className)}>
        <div className="h-4 w-24 bg-muted rounded mb-2" />
        <div className="h-8 w-32 bg-muted rounded" />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground">{value}</span>
        {change !== undefined && (
          <span className={cn('flex items-center gap-1 text-sm font-medium', getTrendColor())}>
            {getTrendIcon()}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      {changeLabel && (
        <p className="mt-1 text-xs text-muted-foreground">{changeLabel}</p>
      )}
    </div>
  );
};

export interface StatCardProps extends StatProps {
  variant?: 'default' | 'elevated';
}

export const StatCard: React.FC<StatCardProps> = ({
  variant = 'default',
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'rounded-xl p-6',
        variant === 'elevated'
          ? 'bg-card shadow-lg'
          : 'bg-card border border-border',
        className
      )}
    >
      <Stat {...props} />
    </div>
  );
};

export interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export const StatGrid: React.FC<StatGridProps> = ({
  children,
  columns = 4,
  className,
}) => {
  const gridClasses = {
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  };

  return (
    <div className={cn('grid gap-4', gridClasses[columns], className)}>
      {children}
    </div>
  );
};
