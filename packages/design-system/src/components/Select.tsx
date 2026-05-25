import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp, X, Search } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================================
   Basic Select (Radix UI based)
   ============================================================================ */

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { error?: boolean }
>(({ className, children, error, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
      error && 'border-destructive focus:ring-destructive',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 pl-8 pr-2 text-sm font-semibold', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

/* ============================================================================
   Searchable Select
   ============================================================================ */

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  emptyMessage?: string;
}

const SearchableSelect = React.forwardRef<HTMLDivElement, SearchableSelectProps>(
  (
    {
      options,
      value,
      onChange,
      placeholder = 'Select an option...',
      searchPlaceholder = 'Search...',
      disabled = false,
      error = false,
      className,
      emptyMessage = 'No options found.',
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const filteredOptions = React.useMemo(() => {
      if (!search) return options;
      return options.filter((option) =>
        option.label.toLowerCase().includes(search.toLowerCase())
      );
    }, [options, search]);

    const selectedOption = options.find((opt) => opt.value === value);

    const handleSelect = (optionValue: string) => {
      onChange?.(optionValue);
      setOpen(false);
      setSearch('');
    };

    React.useEffect(() => {
      if (open && inputRef.current) {
        inputRef.current.focus();
      }
    }, [open]);

    return (
      <div ref={ref} className={cn('relative w-full', className)}>
        <button
          type="button"
          onClick={() => !disabled && setOpen(!open)}
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus:ring-destructive',
            !selectedOption && 'text-muted-foreground'
          )}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto p-1">
                {filteredOptions.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </div>
                ) : (
                  filteredOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => !option.disabled && handleSelect(option.value)}
                      className={cn(
                        'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                        option.disabled && 'pointer-events-none opacity-50',
                        value === option.value && 'bg-accent text-accent-foreground'
                      )}
                      disabled={option.disabled}
                    >
                      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                        {value === option.value && <Check className="h-4 w-4" />}
                      </span>
                      {option.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);
SearchableSelect.displayName = 'SearchableSelect';

/* ============================================================================
   Multi-Select
   ============================================================================ */

export interface MultiSelectProps {
  options: SearchableSelectOption[];
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
  emptyMessage?: string;
  maxDisplayItems?: number;
}

const MultiSelect = React.forwardRef<HTMLDivElement, MultiSelectProps>(
  (
    {
      options,
      value = [],
      onChange,
      placeholder = 'Select options...',
      searchPlaceholder = 'Search...',
      disabled = false,
      error = false,
      className,
      emptyMessage = 'No options found.',
      maxDisplayItems = 3,
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    const filteredOptions = React.useMemo(() => {
      if (!search) return options;
      return options.filter((option) =>
        option.label.toLowerCase().includes(search.toLowerCase())
      );
    }, [options, search]);

    const selectedOptions = options.filter((opt) => value.includes(opt.value));

    const handleToggle = (optionValue: string) => {
      const newValue = value.includes(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue];
      onChange?.(newValue);
    };

    const handleRemove = (optionValue: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.(value.filter((v) => v !== optionValue));
    };

    const handleClearAll = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.([]);
    };

    React.useEffect(() => {
      if (open && inputRef.current) {
        inputRef.current.focus();
      }
    }, [open]);

    const displayItems = selectedOptions.slice(0, maxDisplayItems);
    const remainingCount = selectedOptions.length - maxDisplayItems;

    return (
      <div ref={ref} className={cn('relative w-full', className)}>
        <button
          type="button"
          onClick={() => !disabled && setOpen(!open)}
          className={cn(
            'flex min-h-[40px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus:ring-destructive'
          )}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedOptions.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {displayItems.map((option) => (
                  <span
                    key={option.value}
                    className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
                  >
                    {option.label}
                    <button
                      type="button"
                      onClick={(e) => handleRemove(option.value, e)}
                      className="hover:text-destructive"
                      aria-label={`Remove ${option.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {remainingCount > 0 && (
                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    +{remainingCount} more
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {selectedOptions.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="hover:text-destructive p-0.5"
                aria-label="Clear all"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto p-1">
                {filteredOptions.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {emptyMessage}
                  </div>
                ) : (
                  filteredOptions.map((option) => {
                    const isSelected = value.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => !option.disabled && handleToggle(option.value)}
                        className={cn(
                          'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                          option.disabled && 'pointer-events-none opacity-50',
                          isSelected && 'bg-accent/50'
                        )}
                        disabled={option.disabled}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
                          <div
                            className={cn(
                              'h-4 w-4 rounded border flex items-center justify-center',
                              isSelected
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'border-input'
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                        </span>
                        {option.label}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
);
MultiSelect.displayName = 'MultiSelect';

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
  SearchableSelect,
  MultiSelect,
};
