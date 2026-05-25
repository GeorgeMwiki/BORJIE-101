/**
 * LITFIN-tuned shadcn variant tokens.
 *
 * LITFIN ref: src/core/design-system/ and apps/(*)/components/ui/.
 * These are returned as plain objects so consumers (Tailwind CVA,
 * Stitches, vanilla-extract) can compile them to their own primitives
 * without coupling this package to any styling runtime.
 */

export const BUTTON_VARIANTS = {
  base: 'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  size: {
    sm: 'h-8 px-3',
    md: 'h-9 px-4',
    lg: 'h-10 px-6',
    icon: 'h-9 w-9',
  },
  intent: {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
  },
  loading: {
    /** Class to add when the button is in a pending state. */
    on: 'cursor-progress relative',
    spinner:
      'animate-spin h-4 w-4 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
    /** Whether button label should be hidden while pending. */
    hideLabel: 'opacity-0',
  },
} as const;

export const TABLE_VARIANTS = {
  base: 'w-full caption-bottom text-sm',
  /** Virtual-scroll wrapper — pair with a row virtualizer for >1k rows. */
  virtual: {
    container: 'h-[60vh] overflow-auto contain-strict',
    rowHeight: 44,
    overscan: 6,
  },
  density: {
    compact: 'leading-tight [&_td]:py-1 [&_th]:py-1',
    comfortable: 'leading-snug [&_td]:py-2 [&_th]:py-2',
    spacious: 'leading-normal [&_td]:py-4 [&_th]:py-4',
  },
} as const;

export const DRAWER_VARIANTS = {
  base: 'fixed bg-background shadow-lg z-50 flex flex-col',
  side: {
    left: 'inset-y-0 left-0 border-r',
    right: 'inset-y-0 right-0 border-l',
    top: 'inset-x-0 top-0 border-b',
    bottom: 'inset-x-0 bottom-0 border-t',
  },
  /** Resize handle classes; pair with a pointer-event hook. */
  resize: {
    handle:
      'absolute select-none touch-none bg-transparent hover:bg-accent/40 transition-colors',
    handleSide: {
      left: 'top-0 bottom-0 -right-1 w-2 cursor-col-resize',
      right: 'top-0 bottom-0 -left-1 w-2 cursor-col-resize',
      top: 'left-0 right-0 -bottom-1 h-2 cursor-row-resize',
      bottom: 'left-0 right-0 -top-1 h-2 cursor-row-resize',
    },
    minPx: 240,
    maxPx: 1024,
  },
} as const;

export type ButtonIntent = keyof typeof BUTTON_VARIANTS.intent;
export type ButtonSize = keyof typeof BUTTON_VARIANTS.size;
export type DrawerSide = keyof typeof DRAWER_VARIANTS.side;
export type TableDensity = keyof typeof TABLE_VARIANTS.density;
