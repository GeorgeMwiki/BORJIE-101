import * as React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

/* ============================================================================
   Basic Table Components
   ============================================================================ */

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = 'Table';

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('bg-muted/50', className)} {...props} />
  )
);
TableHeader.displayName = 'TableHeader';

export interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
);
TableBody.displayName = 'TableBody';

export interface TableFooterProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const TableFooter = React.forwardRef<HTMLTableSectionElement, TableFooterProps>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn('border-t bg-muted/50 font-medium', className)}
      {...props}
    />
  )
);
TableFooter.displayName = 'TableFooter';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, selected, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        selected && 'bg-primary/5',
        className
      )}
      data-selected={selected}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: () => void;
}

export const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, sortable, sortDirection, onSort, children, ...props }, ref) => {
    const renderSortIcon = () => {
      if (!sortable) return null;
      if (!sortDirection) return <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />;
      return sortDirection === 'asc' ? (
        <ArrowUp className="ml-2 h-4 w-4 text-primary" />
      ) : (
        <ArrowDown className="ml-2 h-4 w-4 text-primary" />
      );
    };

    return (
      <th
        ref={ref}
        className={cn(
          'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
          sortable && 'cursor-pointer select-none hover:bg-muted/50',
          className
        )}
        onClick={sortable ? onSort : undefined}
        aria-sort={sortDirection ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
        {...props}
      >
        <div className="flex items-center">
          {children}
          {renderSortIcon()}
        </div>
      </th>
    );
  }
);
TableHead.displayName = 'TableHead';

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {}

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  )
);
TableCell.displayName = 'TableCell';

export interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {}

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
  ({ className, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
);
TableCaption.displayName = 'TableCaption';

/* ============================================================================
   Enhanced Sortable Table
   ============================================================================ */

export type SortDirection = 'asc' | 'desc' | null;

export interface SortableColumn<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export interface SortableTableProps<T> {
  data: T[];
  columns: SortableColumn<T>[];
  /** Current sort column */
  sortColumn?: string;
  /** Current sort direction */
  sortDirection?: SortDirection;
  /** Sort change handler */
  onSort?: (columnId: string, direction: SortDirection) => void;
  /** Enable row selection */
  selectable?: boolean;
  /** Selected row IDs */
  selectedRows?: Set<string>;
  /** Selection change handler */
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** Get unique ID from row */
  getRowId?: (row: T) => string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Pagination config */
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  /** Page change handler */
  onPageChange?: (page: number) => void;
  /** Loading state */
  loading?: boolean;
  /** Empty message */
  emptyMessage?: string;
  /** Additional class */
  className?: string;
}

export function SortableTable<T>({
  data,
  columns,
  sortColumn,
  sortDirection,
  onSort,
  selectable = false,
  selectedRows = new Set(),
  onSelectionChange,
  getRowId = (row) => (row as Record<string, unknown>).id as string,
  onRowClick,
  pagination,
  onPageChange,
  loading = false,
  emptyMessage = 'No data available',
  className,
}: SortableTableProps<T>) {
  const handleSort = (columnId: string) => {
    if (!onSort) return;
    let newDirection: SortDirection;
    if (sortColumn !== columnId) {
      newDirection = 'asc';
    } else if (sortDirection === 'asc') {
      newDirection = 'desc';
    } else {
      newDirection = null;
    }
    onSort(columnId, newDirection);
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (selectedRows.size === data.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map(getRowId)));
    }
  };

  const handleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSelectionChange) return;
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    onSelectionChange(newSelected);
  };

  const allSelected = data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < data.length;

  if (loading) {
    return (
      <div className={cn('rounded-lg border border-border', className)}>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={handleSelectAll}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                  aria-label="Select all rows"
                />
              </TableHead>
            )}
            {columns.map((column) => (
              <TableHead
                key={column.id}
                sortable={column.sortable}
                sortDirection={sortColumn === column.id ? sortDirection : null}
                onSort={() => column.sortable && handleSort(column.id)}
                style={{ width: column.width }}
                className={cn(
                  column.align === 'center' && 'text-center',
                  column.align === 'right' && 'text-right'
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="text-center py-12 text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, index) => {
              const rowId = getRowId(row);
              const isSelected = selectedRows.has(rowId);
              return (
                <TableRow
                  key={rowId}
                  selected={isSelected}
                  onClick={() => onRowClick?.(row)}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {selectable && (
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => handleSelectRow(rowId, e)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                        aria-label={`Select row ${index + 1}`}
                      />
                    </TableCell>
                  )}
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        column.align === 'center' && 'text-center',
                        column.align === 'right' && 'text-right'
                      )}
                    >
                      {column.cell
                        ? column.cell(row, index)
                        : column.accessorKey
                        ? String((row as Record<string, unknown>)[column.accessorKey as string] ?? '')
                        : null}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
          <div className="text-sm text-muted-foreground">
            Showing{' '}
            <span className="font-medium">
              {Math.min((pagination.page - 1) * pagination.pageSize + 1, pagination.totalItems)}
            </span>
            {' '}to{' '}
            <span className="font-medium">
              {Math.min(pagination.page * pagination.pageSize, pagination.totalItems)}
            </span>
            {' '}of{' '}
            <span className="font-medium">{pagination.totalItems}</span> results
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
