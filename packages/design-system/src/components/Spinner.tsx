import * as React from 'react';
import { cn } from '../lib/utils';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SpinnerVariant = 'default' | 'primary' | 'secondary' | 'muted' | 'current';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: SpinnerSize;
  variant?: SpinnerVariant;
}

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

const variantClasses: Record<SpinnerVariant, string> = {
  default: 'text-muted-foreground',
  primary: 'text-primary-600',
  secondary: 'text-secondary-600',
  muted: 'text-muted-foreground',
  current: 'text-current',
};

const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  (
    {
      className,
      size = 'md',
      variant = 'default',
      'aria-label': ariaLabel = 'Loading',
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        role="status"
        aria-label={ariaLabel}
        aria-live="polite"
        className="inline-block"
        {...props}
      >
        <svg
          className={cn(
            'animate-spin',
            variantClasses[variant],
            sizeClasses[size],
            className
          )}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }
);
Spinner.displayName = 'Spinner';

export { Spinner };
