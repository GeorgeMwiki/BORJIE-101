/**
 * Kbd — keyboard hint chip.
 *
 * Renders a small slate-tinted chip with mono digit/letter inside.
 * Used in:
 *   - Command palette search hint (`Cmd K`)
 *   - Tooltip footnote (`Esc to close`)
 *   - Inline help (`Press Enter to send`)
 *
 * Anatomy:
 *   <Kbd>Cmd</Kbd>
 *   <Kbd combo>Cmd K</Kbd>
 *   <Kbd size="sm">Esc</Kbd>
 *
 * Honour the OS: surfaces that show `Cmd K` on macOS should show
 * `Ctrl K` on Windows/Linux. Use `useOsKey` (added separately) to
 * map.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const kbdVariants = cva(
  cn(
    'inline-flex items-center justify-center rounded-md border border-border bg-muted/60',
    'font-mono font-medium text-muted-foreground select-none',
    'shadow-[inset_0_-1px_0_0_hsl(var(--border))]',
  ),
  {
    variants: {
      size: {
        sm: 'h-5 min-w-[1.25rem] px-1 text-[10px]',
        md: 'h-6 min-w-[1.5rem] px-1.5 text-[11px]',
        lg: 'h-7 min-w-[1.75rem] px-2 text-xs',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface KbdProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof kbdVariants> {
  /**
   * When true and children is a string with spaces, splits into
   * multiple chips with a thin gap. Renders `Cmd K` as two chips
   * `[Cmd] [K]`. Default false.
   */
  readonly combo?: boolean;
}

/**
 * Single keyboard hint chip. Use `combo` to split a space-separated
 * shortcut into per-key chips.
 */
const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, size, combo = false, children, ...props }, ref) => {
    if (combo && typeof children === 'string') {
      const keys = children.split(/\s+/).filter(Boolean);
      return (
        <span
          ref={ref as React.Ref<HTMLSpanElement>}
          className={cn('inline-flex items-center gap-1', className)}
          {...props}
        >
          {keys.map((key, i) => (
            <kbd key={`${key}-${i}`} className={cn(kbdVariants({ size }))}>
              {key}
            </kbd>
          ))}
        </span>
      );
    }
    return (
      <kbd
        ref={ref}
        className={cn(kbdVariants({ size }), className)}
        {...props}
      >
        {children}
      </kbd>
    );
  },
);
Kbd.displayName = 'Kbd';

export { Kbd, kbdVariants };
