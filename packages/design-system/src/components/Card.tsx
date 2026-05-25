import * as React from 'react';
import { cn } from '../lib/utils';

/* ============================================================================
   Card Component
   ============================================================================ */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Card variant */
  variant?: 'default' | 'outline' | 'ghost' | 'elevated';
  /** Hover effect */
  hoverable?: boolean;
  /** Make card clickable */
  clickable?: boolean;
  /** Padding size */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const cardVariants = {
  default: 'bg-card border border-border shadow-sm',
  outline: 'bg-transparent border border-border',
  ghost: 'bg-transparent',
  elevated: 'bg-card border border-border shadow-lg',
};

const paddingVariants = {
  none: '',
  sm: '[&>*:not(:first-child)]:p-3 [&>*:first-child]:p-3',
  md: '[&>*:not(:first-child)]:p-6 [&>*:first-child]:p-6',
  lg: '[&>*:not(:first-child)]:p-8 [&>*:first-child]:p-8',
};

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', hoverable = false, clickable = false, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg text-card-foreground',
        cardVariants[variant],
        hoverable && 'transition-all duration-200 hover:shadow-md hover:border-border/80',
        clickable && 'cursor-pointer',
        padding && paddingVariants[padding],
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

/* ============================================================================
   Card Header
   ============================================================================ */

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add bottom border */
  bordered?: boolean;
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, bordered = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col space-y-1.5 p-6',
        bordered && 'border-b border-border',
        className
      )}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

/* ============================================================================
   Card Title
   ============================================================================ */

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Title size */
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
};

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, size = 'lg', ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'font-semibold leading-none tracking-tight text-foreground',
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

/* ============================================================================
   Card Description
   ============================================================================ */

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/* ============================================================================
   Card Content
   ============================================================================ */

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

/* ============================================================================
   Card Footer
   ============================================================================ */

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add top border */
  bordered?: boolean;
  /** Alignment */
  align?: 'left' | 'center' | 'right' | 'between';
}

const alignClasses = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
  between: 'justify-between',
};

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, bordered = false, align = 'right', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-2 p-6 pt-0',
        bordered && 'border-t border-border pt-6',
        alignClasses[align],
        className
      )}
      {...props}
    />
  )
);
CardFooter.displayName = 'CardFooter';

/* ============================================================================
   Card Image
   ============================================================================ */

export interface CardImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Image position */
  position?: 'top' | 'bottom';
  /** Aspect ratio */
  aspectRatio?: 'auto' | 'square' | 'video' | '4/3';
}

const aspectRatioClasses = {
  auto: '',
  square: 'aspect-square',
  video: 'aspect-video',
  '4/3': 'aspect-[4/3]',
};

const CardImage = React.forwardRef<HTMLImageElement, CardImageProps>(
  ({ className, position = 'top', aspectRatio = 'auto', alt = '', ...props }, ref) => (
    <div
      className={cn(
        'overflow-hidden',
        position === 'top' ? 'rounded-t-lg' : 'rounded-b-lg',
        aspectRatioClasses[aspectRatio]
      )}
    >
      <img
        ref={ref}
        alt={alt}
        className={cn('h-full w-full object-cover', className)}
        {...props}
      />
    </div>
  )
);
CardImage.displayName = 'CardImage';

/* ============================================================================
   Stat Card (Specialized Card for Statistics)
   ============================================================================ */

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stat title/label */
  title: string;
  /** Main value to display */
  value: string | number;
  /** Optional description or sublabel */
  description?: string;
  /** Icon to display */
  icon?: React.ReactNode;
  /** Trend indicator */
  trend?: {
    value: number;
    label?: string;
  };
  /** Loading state */
  loading?: boolean;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, title, value, description, icon, trend, loading = false, ...props }, ref) => (
    <Card ref={ref} className={cn('p-6', className)} {...props}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="text-2xl font-bold text-foreground">{value}</p>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 text-xs">
              <span
                className={cn(
                  'font-medium',
                  trend.value >= 0 ? 'text-success' : 'text-danger'
                )}
              >
                {trend.value >= 0 ? '+' : ''}
                {trend.value}%
              </span>
              {trend.label && (
                <span className="text-muted-foreground">{trend.label}</span>
              )}
            </div>
          )}
        </div>
        {icon && (
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
);
StatCard.displayName = 'StatCard';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, CardImage, StatCard };
