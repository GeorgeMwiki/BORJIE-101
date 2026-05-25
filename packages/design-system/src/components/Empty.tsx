import * as React from 'react';
import { Inbox, Search, FileQuestion, FolderOpen } from 'lucide-react';
import { cn } from '../utils/cn';
import { Button } from './Button';

export interface EmptyProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'search' | 'error' | 'folder';
  className?: string;
}

const defaultIcons = {
  default: Inbox,
  search: Search,
  error: FileQuestion,
  folder: FolderOpen,
};

export const Empty: React.FC<EmptyProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}) => {
  const DefaultIcon = defaultIcons[variant];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        {icon || <DefaultIcon className="h-8 w-8 text-muted-foreground" />}
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && (
        <div className="mt-6">
          <Button onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </div>
  );
};

export interface EmptySearchProps {
  query: string;
  onClear?: () => void;
  className?: string;
}

export const EmptySearch: React.FC<EmptySearchProps> = ({
  query,
  onClear,
  className,
}) => {
  return (
    <Empty
      variant="search"
      title={`No results for "${query}"`}
      description="Try adjusting your search or filters to find what you're looking for."
      action={
        onClear
          ? {
              label: 'Clear search',
              onClick: onClear,
            }
          : undefined
      }
      className={className}
    />
  );
};
