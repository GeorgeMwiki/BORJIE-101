import * as React from 'react';
import { cn } from '../utils/cn';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
  labelPosition?: 'inside' | 'outside';
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  showLabel = false,
  labelPosition = 'outside',
  className,
  ...props
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const sizeClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const variantClasses = {
    default: 'bg-signal-500',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  };

  return (
    <div className={cn('w-full', className)} {...props}>
      {showLabel && labelPosition === 'outside' && (
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium text-foreground">Progress</span>
          <span className="text-sm font-medium text-foreground">{Math.round(percentage)}%</span>
        </div>
      )}
      <div
        className={cn(
          'w-full bg-muted rounded-full overflow-hidden',
          sizeClasses[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-in-out relative',
            variantClasses[variant]
          )}
          style={{ width: `${percentage}%` }}
        >
          {showLabel && labelPosition === 'inside' && size === 'lg' && (
            <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-primary-foreground">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  showLabel?: boolean;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  value,
  max = 100,
  size = 60,
  strokeWidth = 4,
  variant = 'default',
  showLabel = true,
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  const variantColors = {
    default: 'text-signal-500',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn('transition-all duration-300 ease-in-out', variantColors[variant])}
        />
      </svg>
      {showLabel && (
        <span className="absolute text-sm font-medium text-foreground">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
};
