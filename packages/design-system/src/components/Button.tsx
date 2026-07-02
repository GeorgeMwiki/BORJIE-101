import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Press micro-interaction classes.
 *
 * The scale-down "press" and hover "elevation" are LAYOUT-affecting motion,
 * so they must honour `prefers-reduced-motion`. The gate is expressed two
 * ways for defense-in-depth:
 *
 *  1. As this PURE, unit-testable helper — when `reduceMotion` is true the
 *     transform utilities drop out ENTIRELY, so no scale/translate class is
 *     ever emitted. Fed at runtime by the canonical `useReducedMotion` hook
 *     (SSR-safe, live), it is the JS-level gate.
 *  2. The `motion-safe:` variant on the emitted utilities is the CSS-layer
 *     backstop — even if `reduceMotion` were unknown at render (e.g. an SSR
 *     first paint), the browser still suppresses the motion under a reduced-
 *     motion preference.
 *
 * `pressClasses(false)` → press + hover-lift enabled (still motion-safe gated).
 * `pressClasses(true)`  → identity-only; no scale, no translate, ever.
 */
export function pressClasses(reduceMotion: boolean): string {
  if (reduceMotion) return '';
  return 'motion-safe:active:scale-[0.97] motion-safe:hover:-translate-y-px';
}

const buttonVariants = cva(
  // Base: crisp focus-visible ring on the brand token (--ring is copper),
  // spring-eased transform+color transitions, disabled/loading affordances.
  'group relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[transform,box-shadow,background-color,color] duration-fast ease-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:shadow-none',
  {
    variants: {
      variant: {
        // Solid copper with a subtle inner top-highlight (::before gloss) and
        // hover glow — depth without a new color. Shared by default/primary.
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-glow before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:rounded-t-md before:bg-gradient-to-b before:from-white/15 before:to-transparent',
        primary:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-glow before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:rounded-t-md before:bg-gradient-to-b before:from-white/15 before:to-transparent',
        // IGNITION — the premium hero CTA. Copper gradient wash + copper glow
        // that intensifies on hover. Uses the canonical brand tokens only.
        ignite:
          'bg-gradient-primary text-primary-foreground shadow-glow hover:shadow-glow-lg before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:rounded-t-md before:bg-gradient-to-b before:from-white/20 before:to-transparent',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 hover:shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md',
        danger:
          'bg-danger text-danger-foreground shadow-sm hover:bg-danger/90 hover:shadow-md focus-visible:ring-ring',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:shadow-sm',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        success:
          'bg-success text-success-foreground shadow-sm hover:bg-success/90 hover:shadow-md focus-visible:ring-ring',
        warning:
          'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 hover:shadow-md focus-visible:ring-ring',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8 text-base',
        xl: 'h-12 rounded-md px-10 text-base',
        // Icon sizes meet WCAG 2.2 AA (2.5.8) 24px min target; 40px comfortable.
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
        'icon-lg': 'h-12 w-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as child component using Radix Slot */
  asChild?: boolean;
  /** Show loading spinner and disable button */
  loading?: boolean;
  /** Icon to show before children */
  leftIcon?: React.ReactNode;
  /** Icon to show after children */
  rightIcon?: React.ReactNode;
  /** Full width button */
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    // JS-level reduced-motion gate: when the user prefers reduced motion the
    // press/hover transform utilities are never emitted at all (belt); the
    // `motion-safe:` variant inside them is the CSS-layer braces.
    const reduceMotion = useReducedMotion();
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          pressClasses(reduceMotion),
          fullWidth && 'w-full'
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading}
        aria-disabled={disabled || loading}
        {...props}
      >
        {/* When loading, the spinner REPLACES the left icon but the children
            (the caller's label) STAY — rendering a hardcoded "Loading..." here
            would drop the caller's label and leak English onto a non-English
            locale (zero-mix violation). The caller controls all text. */}
        {loading ? (
          <svg
            className="mr-2 h-4 w-4 flex-shrink-0 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
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
        ) : (
          leftIcon && (
            <span className="relative mr-2 flex-shrink-0">{leftIcon}</span>
          )
        )}
        {/* `relative` keeps the label above the ::before gloss overlay. */}
        <span className="relative">{children}</span>
        {!loading && rightIcon && (
          <span className="relative ml-2 flex-shrink-0">{rightIcon}</span>
        )}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

/** Button group for grouping related buttons */
export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Orientation of the button group */
  orientation?: 'horizontal' | 'vertical';
}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation = 'horizontal', children, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn(
        'inline-flex',
        orientation === 'horizontal'
          ? '[&>button:not(:first-child)]:rounded-l-none [&>button:not(:last-child)]:rounded-r-none [&>button:not(:last-child)]:border-r-0'
          : 'flex-col [&>button:not(:first-child)]:rounded-t-none [&>button:not(:last-child)]:rounded-b-none [&>button:not(:last-child)]:border-b-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
ButtonGroup.displayName = 'ButtonGroup';

export { Button, ButtonGroup, buttonVariants };
