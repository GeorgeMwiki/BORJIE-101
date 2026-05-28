/**
 * SearchInput — LitFin-pattern search field.
 *
 * Wraps the design-system Input with a left-side Search icon and an
 * optional right-side Kbd hint (e.g. `Cmd K`) or clear button when the
 * input has a value.
 *
 * Used in top-bar search, command-palette trigger, filter bars,
 * autocomplete inputs.
 */
import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Kbd } from './Kbd';

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Optional kbd hint to render at the right (e.g. `Cmd K`). */
  readonly hint?: string;
  /** Called when the clear (×) button is clicked. If unset, no button. */
  readonly onClear?: () => void;
  /** Wraps the visible field. Used for full-width vs sized layouts. */
  readonly containerClassName?: string;
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      containerClassName,
      placeholder = 'Search…',
      hint,
      onClear,
      value,
      ...props
    },
    ref,
  ) => {
    const hasValue = typeof value === 'string' && value.length > 0;
    const showClear = Boolean(onClear) && hasValue;
    const showHint = Boolean(hint) && !showClear;

    return (
      <div
        className={cn(
          'relative inline-flex w-full items-center',
          containerClassName,
        )}
      >
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={ref}
          type="search"
          value={value}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-xl border border-border bg-muted/30 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground',
            'transition-all duration-200',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            (showClear || showHint) && 'pr-12',
            className,
          )}
          {...props}
        />
        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              'absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground',
              'transition-colors hover:bg-muted hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label="Clear search"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {showHint ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
          >
            <Kbd size="sm" combo={hint!.includes(' ')}>
              {hint!}
            </Kbd>
          </div>
        ) : null}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';

export { SearchInput };
