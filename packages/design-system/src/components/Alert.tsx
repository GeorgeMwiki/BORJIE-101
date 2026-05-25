import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle, Info, AlertTriangle, X, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================================
   Alert Variants
   ============================================================================ */

const alertVariants = cva(
  'relative w-full rounded-lg border p-4',
  {
    variants: {
      variant: {
        default: 'bg-muted border-border text-foreground',
        info: 'bg-info-subtle border-info/30 text-info',
        success: 'bg-success-subtle border-success/30 text-success',
        warning: 'bg-warning-subtle border-warning/30 text-warning',
        error: 'bg-danger-subtle border-danger/30 text-danger',
        danger: 'bg-danger-subtle border-danger/30 text-danger',
      },
      size: {
        sm: 'p-3 text-sm',
        default: 'p-4',
        lg: 'p-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

/* ============================================================================
   Icon Mapping
   ============================================================================ */

const iconMap = {
  default: Info,
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  danger: XCircle,
  error: AlertCircle,
};

const iconColorMap = {
  default: 'text-muted-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  error: 'text-danger',
};

/* ============================================================================
   Alert Component
   ============================================================================ */

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  /** Alert title */
  title?: string;
  /** Make alert dismissible */
  dismissible?: boolean;
  /** Callback when alert is dismissed */
  onDismiss?: () => void;
  /** Custom icon */
  icon?: React.ReactNode;
  /** Hide the icon */
  hideIcon?: boolean;
  /** Actions to display in the alert */
  actions?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      variant,
      size,
      title,
      dismissible,
      onDismiss,
      icon,
      hideIcon = false,
      actions,
      children,
      ...props
    },
    ref
  ) => {
    const [isVisible, setIsVisible] = React.useState(true);
    const Icon = iconMap[variant || 'default'];
    const iconColor = iconColorMap[variant || 'default'];

    const handleDismiss = () => {
      setIsVisible(false);
      onDismiss?.();
    };

    if (!isVisible) return null;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant, size }), className)}
        {...props}
      >
        <div className="flex">
          {!hideIcon && (
            <div className="flex-shrink-0">
              {icon || <Icon className={cn('h-5 w-5', iconColor)} aria-hidden="true" />}
            </div>
          )}
          <div className={cn('flex-1', !hideIcon && 'ml-3')}>
            {title && (
              <h3 className="text-sm font-semibold">{title}</h3>
            )}
            {children && (
              <div className={cn('text-sm', title && 'mt-1', 'opacity-90')}>
                {children}
              </div>
            )}
            {actions && (
              <div className="mt-3 flex gap-2">
                {actions}
              </div>
            )}
          </div>
          {dismissible && (
            <div className="ml-auto pl-3">
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss alert"
                className="inline-flex rounded-md p-1.5 hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
);

Alert.displayName = 'Alert';

/* ============================================================================
   Alert Title (Standalone)
   ============================================================================ */

export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

/* ============================================================================
   Alert Description (Standalone)
   ============================================================================ */

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

/* ============================================================================
   Inline Alert (Compact version)
   ============================================================================ */

export interface InlineAlertProps extends Omit<AlertProps, 'size'> {
  /** Inline message */
  message: string;
}

export const InlineAlert = React.forwardRef<HTMLDivElement, InlineAlertProps>(
  ({ variant = 'info', message, dismissible, onDismiss, className, ...props }, ref) => {
    const [isVisible, setIsVisible] = React.useState(true);
    const Icon = iconMap[variant || 'default'];
    const iconColor = iconColorMap[variant || 'default'];

    if (!isVisible) return null;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm',
          alertVariants({ variant }),
          className
        )}
        {...props}
      >
        <Icon className={cn('h-4 w-4 flex-shrink-0', iconColor)} aria-hidden="true" />
        <span>{message}</span>
        {dismissible && (
          <button
            type="button"
            onClick={() => {
              setIsVisible(false);
              onDismiss?.();
            }}
            aria-label="Dismiss"
            className="ml-1 rounded p-0.5 hover:bg-foreground/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
);
InlineAlert.displayName = 'InlineAlert';

/* ============================================================================
   Banner Alert (Full-width, top of page)
   ============================================================================ */

export interface BannerAlertProps extends Omit<AlertProps, 'size'> {
  /** Action button */
  actionLabel?: string;
  /** Action handler */
  onAction?: () => void;
}

export const BannerAlert = React.forwardRef<HTMLDivElement, BannerAlertProps>(
  ({ variant = 'info', title, children, dismissible, onDismiss, actionLabel, onAction, className, ...props }, ref) => {
    const [isVisible, setIsVisible] = React.useState(true);
    const Icon = iconMap[variant || 'default'];

    if (!isVisible) return null;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'w-full border-x-0 rounded-none',
          alertVariants({ variant }),
          className
        )}
        {...props}
      >
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <div>
              {title && <span className="font-medium">{title}</span>}
              {children && <span className={title ? 'ml-2' : ''}>{children}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {actionLabel && (
              <button
                type="button"
                onClick={onAction}
                className="text-sm font-medium underline underline-offset-4 hover:no-underline"
              >
                {actionLabel}
              </button>
            )}
            {dismissible && (
              <button
                type="button"
                onClick={() => {
                  setIsVisible(false);
                  onDismiss?.();
                }}
                aria-label="Dismiss"
                className="rounded p-1 hover:bg-foreground/5"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);
BannerAlert.displayName = 'BannerAlert';

export { alertVariants };
