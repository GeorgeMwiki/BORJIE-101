import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Filter,
  Download,
  RefreshCw,
  Settings2,
  Columns,
  Check,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './Button';
import { Input } from './Input';

/* ============================================================================
   Types & Interfaces
   ============================================================================ */

export interface Column<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  width?: string | number;
  minWidth?: string | number;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
  pinned?: 'left' | 'right';
}

export interface FilterConfig {
  columnId: string;
  value: string;
  operator?: 'contains' | 'equals' | 'startsWith' | 'endsWith';
}

export interface DataGridProps<T> {
  /** Data array */
  data: T[];
  /** Column definitions */
  columns: Column<T>[];
  /** Loading state */
  loading?: boolean;
  /** Empty message */
  emptyMessage?: string;
  /** Empty description */
  emptyDescription?: string;
  /** Pagination config */
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  /** Page change handler */
  onPageChange?: (page: number) => void;
  /** Page size change handler */
  onPageSizeChange?: (pageSize: number) => void;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Sort change handler */
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  /** Current sort column */
  sortColumn?: string;
  /** Current sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Enable row selection */
  selectable?: boolean;
  /** Selected row IDs */
  selectedRows?: Set<string>;
  /** Selection change handler */
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** Get row ID function */
  getRowId?: (row: T) => string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Enable global search */
  searchable?: boolean;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Search value */
  searchValue?: string;
  /** Search change handler */
  onSearchChange?: (value: string) => void;
  /** Enable column filters */
  filterable?: boolean;
  /** Active filters */
  filters?: FilterConfig[];
  /** Filter change handler */
  onFilterChange?: (filters: FilterConfig[]) => void;
  /** Enable column visibility toggle */
  columnToggle?: boolean;
  /** Hidden columns */
  hiddenColumns?: string[];
  /** Hidden columns change handler */
  onHiddenColumnsChange?: (columnIds: string[]) => void;
  /** Enable export */
  exportable?: boolean;
  /** Export handler */
  onExport?: (format: 'csv' | 'json') => void;
  /** Enable refresh */
  refreshable?: boolean;
  /** Refresh handler */
  onRefresh?: () => void;
  /** Toolbar actions */
  toolbarActions?: React.ReactNode;
  /** Additional class */
  className?: string;
  /** Striped rows */
  striped?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Sticky header */
  stickyHeader?: boolean;
  /** Max height for scrollable body */
  maxHeight?: string | number;
}

/* ============================================================================
   DataGrid Component
   ============================================================================ */

export function DataGrid<T>({
  data,
  columns,
  loading,
  emptyMessage = 'No data available',
  emptyDescription,
  pagination,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  onSort,
  sortColumn,
  sortDirection,
  selectable,
  selectedRows = new Set(),
  onSelectionChange,
  getRowId = (row: T) => (row as Record<string, unknown>).id as string,
  onRowClick,
  searchable = false,
  searchPlaceholder = 'Search...',
  searchValue = '',
  onSearchChange,
  filterable = false,
  filters = [],
  onFilterChange,
  columnToggle = false,
  hiddenColumns = [],
  onHiddenColumnsChange,
  exportable = false,
  onExport,
  refreshable = false,
  onRefresh,
  toolbarActions,
  className,
  striped = false,
  compact = false,
  stickyHeader = false,
  maxHeight,
}: DataGridProps<T>) {
  const [showFilters, setShowFilters] = React.useState(false);
  const [showColumnToggle, setShowColumnToggle] = React.useState(false);
  const columnToggleRef = React.useRef<HTMLDivElement>(null);

  // Visible columns
  const visibleColumns = columns.filter((col) => !col.hidden && !hiddenColumns.includes(col.id));

  // Handle sort
  const handleSort = (columnId: string) => {
    if (!onSort) return;
    const newDirection =
      sortColumn === columnId && sortDirection === 'asc' ? 'desc' : 'asc';
    onSort(columnId, newDirection);
  };

  // Handle select all
  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (selectedRows.size === data.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map(getRowId)));
    }
  };

  // Handle select row
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

  // Handle filter change
  const handleFilterChange = (columnId: string, value: string) => {
    if (!onFilterChange) return;
    const existingFilter = filters.find((f) => f.columnId === columnId);
    if (existingFilter) {
      if (!value) {
        onFilterChange(filters.filter((f) => f.columnId !== columnId));
      } else {
        onFilterChange(
          filters.map((f) =>
            f.columnId === columnId ? { ...f, value } : f
          )
        );
      }
    } else if (value) {
      onFilterChange([...filters, { columnId, value, operator: 'contains' }]);
    }
  };

  // Handle column visibility toggle
  const handleColumnToggle = (columnId: string) => {
    if (!onHiddenColumnsChange) return;
    if (hiddenColumns.includes(columnId)) {
      onHiddenColumnsChange(hiddenColumns.filter((id) => id !== columnId));
    } else {
      onHiddenColumnsChange([...hiddenColumns, columnId]);
    }
  };

  // Sort icon
  const renderSortIcon = (columnId: string) => {
    if (sortColumn !== columnId) {
      return <ArrowUpDown className="ml-1 h-4 w-4 text-muted-foreground/50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-4 w-4 text-primary" />
    ) : (
      <ArrowDown className="ml-1 h-4 w-4 text-primary" />
    );
  };

  // Close column toggle on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (columnToggleRef.current && !columnToggleRef.current.contains(e.target as Node)) {
        setShowColumnToggle(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allSelected = data.length > 0 && selectedRows.size === data.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < data.length;
  const hasToolbar = searchable || filterable || columnToggle || exportable || refreshable || toolbarActions;

  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      {/* Toolbar */}
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex items-center gap-2">
            {/* Search */}
            {searchable && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 w-64 rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {searchValue && (
                  <button
                    type="button"
                    onClick={() => onSearchChange?.('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {/* Filter Toggle */}
            {filterable && (
              <Button
                variant={showFilters || filters.length > 0 ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {filters.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                    {filters.length}
                  </span>
                )}
              </Button>
            )}

            {/* Selection info */}
            {selectable && selectedRows.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedRows.size} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {toolbarActions}

            {/* Column Toggle */}
            {columnToggle && (
              <div className="relative" ref={columnToggleRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowColumnToggle(!showColumnToggle)}
                >
                  <Columns className="mr-2 h-4 w-4" />
                  Columns
                </Button>
                {showColumnToggle && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-popover p-2 shadow-lg">
                    {columns.map((column) => (
                      <button
                        key={column.id}
                        type="button"
                        onClick={() => handleColumnToggle(column.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <div
                          className={cn(
                            'h-4 w-4 rounded border flex items-center justify-center',
                            !hiddenColumns.includes(column.id)
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-input'
                          )}
                        >
                          {!hiddenColumns.includes(column.id) && (
                            <Check className="h-3 w-3" />
                          )}
                        </div>
                        {column.header}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Export */}
            {exportable && onExport && (
              <Button variant="outline" size="sm" onClick={() => onExport('csv')}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            )}

            {/* Refresh */}
            {refreshable && onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filters Row */}
      {filterable && showFilters && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 p-4">
          {visibleColumns
            .filter((col) => col.filterable !== false)
            .map((column) => {
              const filter = filters.find((f) => f.columnId === column.id);
              return (
                <div key={column.id} className="flex-shrink-0">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {column.header}
                  </label>
                  <input
                    type="text"
                    value={filter?.value || ''}
                    onChange={(e) => handleFilterChange(column.id, e.target.value)}
                    placeholder={`Filter ${column.header.toLowerCase()}...`}
                    className="h-8 w-40 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              );
            })}
          {filters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFilterChange?.([])}
              className="self-end"
            >
              Clear all
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div
        className={cn('overflow-auto', stickyHeader && 'relative')}
        style={{ maxHeight }}
      >
        <table className="min-w-full divide-y divide-border">
          <thead className={cn('bg-muted/50', stickyHeader && 'sticky top-0 z-10')}>
            <tr>
              {selectable && (
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                    aria-label="Select all"
                  />
                </th>
              )}
              {visibleColumns.map((column) => (
                <th
                  key={column.id}
                  className={cn(
                    'px-4 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground',
                    compact ? 'py-2' : 'py-3',
                    column.align === 'center' && 'text-center',
                    column.align === 'right' && 'text-right',
                    column.sortable && 'cursor-pointer select-none hover:bg-muted/50'
                  )}
                  style={{ width: column.width, minWidth: column.minWidth }}
                  onClick={() => column.sortable && handleSort(column.id)}
                >
                  <span className="inline-flex items-center">
                    {column.header}
                    {column.sortable && renderSortIcon(column.id)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {loading ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                  className="py-12 text-center"
                >
                  <div className="flex items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                  className="py-12 text-center"
                >
                  <div className="text-muted-foreground">
                    <p className="text-sm font-medium">{emptyMessage}</p>
                    {emptyDescription && (
                      <p className="mt-1 text-xs">{emptyDescription}</p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row, index) => {
                const rowId = getRowId(row);
                const isSelected = selectedRows.has(rowId);
                return (
                  <tr
                    key={rowId}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      'transition-colors',
                      onRowClick && 'cursor-pointer',
                      'hover:bg-muted/50',
                      isSelected && 'bg-primary/5',
                      striped && index % 2 === 1 && 'bg-muted/30'
                    )}
                  >
                    {selectable && (
                      <td className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          onClick={(e) => handleSelectRow(rowId, e)}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                          aria-label={`Select row ${index + 1}`}
                        />
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          'whitespace-nowrap px-4 text-sm text-foreground',
                          compact ? 'py-2' : 'py-3',
                          column.align === 'center' && 'text-center',
                          column.align === 'right' && 'text-right'
                        )}
                      >
                        {column.cell
                          ? column.cell(row, index)
                          : column.accessorKey
                          ? String((row as Record<string, unknown>)[column.accessorKey as string] ?? '')
                          : null}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
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
            </span>

            {onPageSizeChange && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Rows per page:</span>
                <select
                  value={pagination.pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {pageSizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(1)}
              disabled={pagination.page === 1}
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page === pagination.totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.totalPages)}
              disabled={pagination.page === pagination.totalPages}
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   Simple DataGrid (Auto-managed state)
   ============================================================================ */

export interface SimpleDataGridProps<T> extends Omit<
  DataGridProps<T>,
  'pagination' | 'onPageChange' | 'searchValue' | 'onSearchChange' | 'sortColumn' | 'sortDirection' | 'onSort'
> {
  /** Enable client-side pagination */
  paginate?: boolean;
  /** Default page size */
  defaultPageSize?: number;
  /** Enable client-side sorting */
  sortable?: boolean;
}

export function SimpleDataGrid<T>({
  data: rawData,
  columns,
  paginate = true,
  defaultPageSize = 10,
  searchable = false,
  sortable = true,
  getRowId = (row: T) => (row as Record<string, unknown>).id as string,
  ...props
}: SimpleDataGridProps<T>) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(defaultPageSize);
  const [search, setSearch] = React.useState('');
  const [sortColumn, setSortColumn] = React.useState<string>();
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');

  // Filter data by search
  const filteredData = React.useMemo(() => {
    if (!search) return rawData;
    return rawData.filter((row) =>
      columns.some((col) => {
        const value = col.accessorKey
          ? String((row as Record<string, unknown>)[col.accessorKey as string] ?? '')
          : '';
        return value.toLowerCase().includes(search.toLowerCase());
      })
    );
  }, [rawData, search, columns]);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortColumn) return filteredData;
    const column = columns.find((c) => c.id === sortColumn);
    if (!column?.accessorKey) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[column.accessorKey as string];
      const bVal = (b as Record<string, unknown>)[column.accessorKey as string];
      const comparison = String(aVal ?? '').localeCompare(String(bVal ?? ''));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection, columns]);

  // Paginate data
  const paginatedData = React.useMemo(() => {
    if (!paginate) return sortedData;
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize, paginate]);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [search]);

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    setSortColumn(columnId);
    setSortDirection(direction);
  };

  const enhancedColumns = columns.map((col) => ({
    ...col,
    sortable: sortable && col.sortable !== false,
  }));

  return (
    <DataGrid
      data={paginatedData}
      columns={enhancedColumns}
      getRowId={getRowId}
      searchable={searchable}
      searchValue={search}
      onSearchChange={setSearch}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSort={handleSort}
      pagination={
        paginate
          ? {
              page,
              pageSize,
              totalItems: sortedData.length,
              totalPages: Math.ceil(sortedData.length / pageSize),
            }
          : undefined
      }
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      {...props}
    />
  );
}
