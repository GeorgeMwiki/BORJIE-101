import * as React from 'react';
import { Bell, Search, Menu, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { Avatar } from './Avatar';
import { Dropdown, DropdownItem } from './Dropdown';

export interface HeaderProps {
  logo?: React.ReactNode;
  title?: string;
  user?: {
    name: string;
    email: string;
    avatarUrl?: string;
  };
  userMenuItems?: DropdownItem[];
  notifications?: number;
  onNotificationsClick?: () => void;
  onMenuClick?: () => void;
  showMobileMenu?: boolean;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  actions?: React.ReactNode;
  className?: string;
}

export const Header: React.FC<HeaderProps> = ({
  logo,
  title,
  user,
  userMenuItems = [],
  notifications,
  onNotificationsClick,
  onMenuClick,
  showMobileMenu,
  searchPlaceholder = 'Search...',
  onSearch,
  actions,
  className,
}) => {
  const [searchQuery, setSearchQuery] = React.useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border bg-surface px-4 sm:px-6',
        className
      )}
    >
      {/* Mobile menu button */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="lg:hidden -m-2.5 p-2.5 text-foreground hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          {showMobileMenu ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      )}

      {/* Logo / Title */}
      <div className="flex items-center gap-3">
        {logo}
        {title && (
          <h1 className="text-lg font-semibold text-foreground hidden sm:block">
            {title}
          </h1>
        )}
      </div>

      {/* Search */}
      {onSearch && (
        <form
          onSubmit={handleSearchSubmit}
          className="hidden md:flex flex-1 max-w-md mx-4"
        >
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 rounded-lg border border-input bg-surface-sunken pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:bg-background focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </form>
      )}

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Custom actions */}
        {actions}

        {/* Notifications */}
        {onNotificationsClick && (
          <button
            onClick={onNotificationsClick}
            className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Bell className="h-5 w-5" />
            {notifications !== undefined && notifications > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-xs font-medium text-danger-foreground">
                {notifications > 99 ? '99+' : notifications}
              </span>
            )}
          </button>
        )}

        {/* User menu */}
        {user && (
          <Dropdown
            align="right"
            items={userMenuItems}
            trigger={
              <button className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Avatar
                  src={user.avatarUrl}
                  name={user.name}
                  size="sm"
                />
                <div className="hidden lg:block text-left">
                  <p className="text-sm font-medium text-foreground">
                    {user.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </button>
            }
          />
        )}
      </div>
    </header>
  );
};

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}) => {
  return (
    <div className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex" aria-label="Breadcrumb">
          <ol className="flex items-center space-x-2">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="flex items-center">
                {index > 0 && (
                  <span className="mx-2 text-muted-foreground">/</span>
                )}
                {crumb.href ? (
                  <a
                    href={crumb.href}
                    className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
};
