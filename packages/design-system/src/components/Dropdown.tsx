import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

export interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  trigger,
  items,
  align = 'left',
  className,
}) => {
  const [open, setOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn('relative inline-block text-left', className)} ref={dropdownRef}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className={cn(
            'absolute z-50 mt-2 w-56 rounded-lg bg-popover text-popover-foreground shadow-lg border border-border focus:outline-none',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          <div className="py-1">
            {items.map((item) =>
              item.divider ? (
                <div key={item.id} className="my-1 border-t border-border" role="separator" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    item.onClick?.();
                    setOpen(false);
                  }}
                  disabled={item.disabled}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-2 text-sm text-left',
                    item.disabled
                      ? 'cursor-not-allowed text-muted-foreground'
                      : item.danger
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'text-foreground hover:bg-accent'
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export interface DropdownButtonProps {
  children: React.ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
}

export const DropdownButton: React.FC<DropdownButtonProps> = ({
  children,
  items,
  align = 'left',
}) => {
  return (
    <Dropdown
      align={align}
      items={items}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {children}
          <ChevronDown className="h-4 w-4" />
        </button>
      }
    />
  );
};
