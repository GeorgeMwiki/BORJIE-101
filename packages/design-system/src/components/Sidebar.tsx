import * as React from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, Menu, X } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================================
   Sidebar Types
   ============================================================================ */

export interface SidebarItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  badge?: string | number;
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  children?: SidebarItem[];
  active?: boolean;
  disabled?: boolean;
}

export interface SidebarSection {
  id: string;
  title?: string;
  items: SidebarItem[];
}

export interface SidebarProps {
  /** Navigation items */
  items?: SidebarItem[];
  /** Grouped navigation sections */
  sections?: SidebarSection[];
  /** Header content */
  header?: React.ReactNode;
  /** Footer content */
  footer?: React.ReactNode;
  /** Collapsed state */
  collapsed?: boolean;
  /** Collapse handler */
  onCollapse?: (collapsed: boolean) => void;
  /** Show collapse toggle */
  collapsible?: boolean;
  /** Fixed position */
  fixed?: boolean;
  /** Additional class names */
  className?: string;
  /** Width when expanded */
  expandedWidth?: string;
  /** Width when collapsed */
  collapsedWidth?: string;
}

/* ============================================================================
   Main Sidebar Component
   ============================================================================ */

export const Sidebar: React.FC<SidebarProps> = ({
  items = [],
  sections = [],
  header,
  footer,
  collapsed = false,
  onCollapse,
  collapsible = true,
  fixed = false,
  className,
  expandedWidth = '256px',
  collapsedWidth = '64px',
}) => {
  // Render items or sections
  const renderNavItems = () => {
    if (sections.length > 0) {
      return sections.map((section) => (
        <SidebarSectionComponent
          key={section.id}
          title={section.title}
          collapsed={collapsed}
        >
          {section.items.map((item) => (
            <SidebarNavItem key={item.id} item={item} collapsed={collapsed} />
          ))}
        </SidebarSectionComponent>
      ));
    }
    return items.map((item) => (
      <SidebarNavItem key={item.id} item={item} collapsed={collapsed} />
    ));
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-card border-r border-border transition-all duration-200',
        fixed && 'fixed left-0 top-0 z-40',
        className
      )}
      style={{ width: collapsed ? collapsedWidth : expandedWidth }}
    >
      {/* Header */}
      {header && (
        <div
          className={cn(
            'flex-shrink-0 border-b border-border',
            collapsed ? 'px-2 py-4' : 'px-4 py-4'
          )}
        >
          {header}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <ul className={cn('space-y-1', collapsed ? 'px-2' : 'px-3')}>
          {renderNavItems()}
        </ul>
      </nav>

      {/* Footer */}
      {footer && (
        <div
          className={cn(
            'flex-shrink-0 border-t border-border',
            collapsed ? 'px-2 py-4' : 'px-4 py-4'
          )}
        >
          {footer}
        </div>
      )}

      {/* Collapse Toggle */}
      {collapsible && onCollapse && (
        <button
          type="button"
          onClick={() => onCollapse(!collapsed)}
          className={cn(
            'absolute -right-3 top-6 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:bg-muted transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      )}
    </aside>
  );
};

/* ============================================================================
   Sidebar Section
   ============================================================================ */

interface SidebarSectionComponentProps {
  title?: string;
  collapsed: boolean;
  children: React.ReactNode;
}

const SidebarSectionComponent: React.FC<SidebarSectionComponentProps> = ({
  title,
  collapsed,
  children,
}) => (
  <li className="mb-4">
    {title && !collapsed && (
      <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
    )}
    <ul className="space-y-1">{children}</ul>
  </li>
);

/* ============================================================================
   Sidebar Nav Item
   ============================================================================ */

interface SidebarNavItemProps {
  item: SidebarItem;
  collapsed: boolean;
  depth?: number;
}

const badgeVariantClasses = {
  default: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-danger-subtle text-danger',
};

const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  item,
  collapsed,
  depth = 0,
}) => {
  const [expanded, setExpanded] = React.useState(item.active || false);
  const hasChildren = item.children && item.children.length > 0;

  const handleClick = (e: React.MouseEvent) => {
    if (hasChildren) {
      e.preventDefault();
      setExpanded(!expanded);
    } else if (item.onClick) {
      item.onClick();
    }
  };

  const Component = item.href && !hasChildren ? 'a' : 'button';
  const componentProps = item.href && !hasChildren ? { href: item.href } : { type: 'button' as const };

  return (
    <li>
      <Component
        {...componentProps}
        onClick={handleClick}
        disabled={item.disabled}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          item.active
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          item.disabled && 'pointer-events-none opacity-50',
          depth > 0 && !collapsed && 'ml-4',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? item.label : undefined}
        aria-current={item.active ? 'page' : undefined}
      >
        {item.icon && (
          <span className={cn('flex-shrink-0', item.active && 'text-primary')}>
            {item.icon}
          </span>
        )}
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={cn(
                  'flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  badgeVariantClasses[item.badgeVariant || 'default']
                )}
              >
                {item.badge}
              </span>
            )}
            {hasChildren && (
              <span className="flex-shrink-0">
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
            )}
          </>
        )}
      </Component>
      {hasChildren && expanded && !collapsed && (
        <ul className="mt-1 space-y-1">
          {item.children!.map((child) => (
            <SidebarNavItem
              key={child.id}
              item={child}
              collapsed={collapsed}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/* ============================================================================
   Mobile Sidebar (Drawer)
   ============================================================================ */

export interface MobileSidebarProps extends Omit<SidebarProps, 'collapsed' | 'onCollapse' | 'collapsible' | 'fixed'> {
  open: boolean;
  onClose: () => void;
}

export const MobileSidebar: React.FC<MobileSidebarProps> = ({
  open,
  onClose,
  items = [],
  sections = [],
  header,
  footer,
  className,
}) => {
  // Handle escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onClose]);

  if (!open) return null;

  const renderNavItems = () => {
    if (sections.length > 0) {
      return sections.map((section) => (
        <SidebarSectionComponent
          key={section.id}
          title={section.title}
          collapsed={false}
        >
          {section.items.map((item) => (
            <SidebarNavItem key={item.id} item={item} collapsed={false} />
          ))}
        </SidebarSectionComponent>
      ));
    }
    return items.map((item) => (
      <SidebarNavItem key={item.id} item={item} collapsed={false} />
    ));
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card shadow-xl animate-in slide-in-from-left',
          className
        )}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          {header || <div />}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">{renderNavItems()}</ul>
        </nav>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 border-t border-border px-4 py-4">
            {footer}
          </div>
        )}
      </aside>
    </>
  );
};

/* ============================================================================
   Sidebar Toggle Button
   ============================================================================ */

export interface SidebarToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Sidebar open state (for mobile) */
  open?: boolean;
}

export const SidebarToggle = React.forwardRef<HTMLButtonElement, SidebarToggleProps>(
  ({ className, open, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className
      )}
      aria-label={open ? 'Close menu' : 'Open menu'}
      {...props}
    >
      {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </button>
  )
);
SidebarToggle.displayName = 'SidebarToggle';

/* ============================================================================
   Sidebar Section Export
   ============================================================================ */

export interface SidebarSectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({
  title,
  children,
  className,
}) => (
  <div className={cn('py-4', className)}>
    {title && (
      <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
    )}
    {children}
  </div>
);
