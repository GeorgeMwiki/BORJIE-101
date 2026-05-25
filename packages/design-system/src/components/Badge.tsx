import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================================
   Badge Variants
   ============================================================================ */

const badgeVariants = cva(
  'inline-flex items-center rounded-full border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground border-border',
        success: 'border-transparent bg-success text-success-foreground hover:bg-success/90',
        warning: 'border-transparent bg-warning text-warning-foreground hover:bg-warning/90',
        error: 'border-transparent bg-danger text-danger-foreground hover:bg-danger/90',
        info: 'border-transparent bg-info text-info-foreground hover:bg-info/90',
        // Soft variants (lighter backgrounds)
        'success-soft': 'border-transparent bg-success-subtle text-success',
        'warning-soft': 'border-transparent bg-warning-subtle text-warning',
        'error-soft': 'border-transparent bg-danger-subtle text-danger',
        'info-soft': 'border-transparent bg-info-subtle text-info',
      },
      size: {
        sm: 'px-2 py-0.5 text-[10px]',
        default: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

/* ============================================================================
   Badge Component
   ============================================================================ */

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional icon to display before text */
  icon?: React.ReactNode;
  /** Optional dot indicator */
  dot?: boolean;
  /** Dot color (only when dot is true) */
  dotColor?: 'default' | 'success' | 'warning' | 'error' | 'info';
  /** Make badge removable */
  removable?: boolean;
  /** Callback when remove button is clicked */
  onRemove?: () => void;
}

const dotColorClasses = {
  default: 'bg-current',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-danger',
  info: 'bg-info',
};

function Badge({
  className,
  variant,
  size,
  icon,
  dot,
  dotColor = 'default',
  removable,
  onRemove,
  children,
  ...props
}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && (
        <span
          className={cn('mr-1.5 h-1.5 w-1.5 rounded-full', dotColorClasses[dotColor])}
          aria-hidden="true"
        />
      )}
      {icon && <span className="mr-1 -ml-0.5">{icon}</span>}
      {children}
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-1 -mr-0.5 rounded-full p-0.5 hover:bg-foreground/10 focus:outline-none focus:ring-1 focus:ring-current"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* ============================================================================
   Status Badge (Specialized for status indicators)
   ============================================================================ */

export type StatusType = 'active' | 'inactive' | 'pending' | 'success' | 'error' | 'warning';

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'dot' | 'dotColor'> {
  status: StatusType;
  showDot?: boolean;
}

const statusConfig: Record<StatusType, { variant: BadgeProps['variant']; label: string }> = {
  active: { variant: 'success-soft', label: 'Active' },
  inactive: { variant: 'secondary', label: 'Inactive' },
  pending: { variant: 'warning-soft', label: 'Pending' },
  success: { variant: 'success-soft', label: 'Success' },
  error: { variant: 'error-soft', label: 'Error' },
  warning: { variant: 'warning-soft', label: 'Warning' },
};

function StatusBadge({ status, showDot = true, children, ...props }: StatusBadgeProps) {
  const config = statusConfig[status];
  const dotColor = status === 'active' || status === 'success'
    ? 'success'
    : status === 'error'
    ? 'error'
    : status === 'warning' || status === 'pending'
    ? 'warning'
    : 'default';

  return (
    <Badge variant={config.variant} dot={showDot} dotColor={dotColor} {...props}>
      {children || config.label}
    </Badge>
  );
}

/* ============================================================================
   Badge Group
   ============================================================================ */

export interface BadgeGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Maximum number of badges to show before collapsing */
  max?: number;
  /** Badge items */
  items: Array<{ id: string; label: string; variant?: BadgeProps['variant'] }>;
  /** Size for all badges */
  size?: BadgeProps['size'];
}

function BadgeGroup({ items, max = 5, size, className, ...props }: BadgeGroupProps) {
  const visibleItems = max ? items.slice(0, max) : items;
  const remainingCount = items.length - visibleItems.length;

  return (
    <div className={cn('flex flex-wrap gap-1', className)} {...props}>
      {visibleItems.map((item) => (
        <Badge key={item.id} variant={item.variant} size={size}>
          {item.label}
        </Badge>
      ))}
      {remainingCount > 0 && (
        <Badge variant="secondary" size={size}>
          +{remainingCount}
        </Badge>
      )}
    </div>
  );
}

export { Badge, StatusBadge, BadgeGroup, badgeVariants };
