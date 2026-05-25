import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Pagination } from '../Pagination';

// ============================================================================
// Table Components
// ============================================================================

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        role="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

// ============================================================================
// DataTable Component (Higher-level wrapper)
// ============================================================================

export type SortDirection = 'asc' | 'desc' | null;

export interface Column<T> {
  key: string;
  header: string | React.ReactNode;
  cell: (item: T, index: number) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  /** Sort key - used when sortable. Defaults to column key */
  sortKey?: string;
  /** Custom sort comparator */
  sortFn?: (a: T, b: T) => number;
}

export interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T, index: number) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  /** Pagination: page size (items per page). If set, enables pagination */
  pageSize?: number;
  /** Controlled pagination: current page (1-indexed) */
  currentPage?: number;
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Sorting: controlled sort column key */
  sortColumn?: string;
  /** Sorting: controlled sort direction */
  sortDirection?: SortDirection;
  /** Callback when sort changes */
  onSortChange?: (column: string, direction: SortDirection) => void;
  /** Show pagination controls */
  showPagination?: boolean;
}

function defaultSort<T>(a: T, b: T, key: string): number {
  const aVal = (a as Record<string, unknown>)[key];
  const bVal = (b as Record<string, unknown>)[key];
  if (aVal == null && bVal == null) return 0;
  if (aVal == null) return 1;
  if (bVal == null) return -1;
  if (typeof aVal === 'string' && typeof bVal === 'string') {
    return aVal.localeCompare(bVal);
  }
  if (typeof aVal === 'number' && typeof bVal === 'number') {
    return aVal - bVal;
  }
  return String(aVal).localeCompare(String(bVal));
}

function DataTable<T>({
  className,
  data,
  columns,
  keyExtractor,
  isLoading,
  emptyMessage = 'No data available',
  onRowClick,
  pageSize,
  currentPage: controlledPage,
  onPageChange,
  sortColumn: controlledSortColumn,
  sortDirection: controlledSortDirection,
  onSortChange,
  showPagination = true,
  ...props
}: DataTableProps<T>) {
  const [internalSortColumn, setInternalSortColumn] = React.useState<string | null>(null);
  const [internalSortDirection, setInternalSortDirection] = React.useState<SortDirection>(null);
  const [internalPage, setInternalPage] = React.useState(1);

  const isControlledSort = controlledSortColumn !== undefined;
  const isControlledPage = controlledPage !== undefined;
  const sortColumn = isControlledSort ? controlledSortColumn ?? null : internalSortColumn;
  const sortDirection = isControlledSort ? controlledSortDirection ?? null : internalSortDirection;
  const currentPage = isControlledPage ? controlledPage : internalPage;

  const handleSort = (columnKey: string) => {
    const column = columns.find((c) => c.key === columnKey);
    if (!column?.sortable) return;

    const nextDirection: SortDirection =
      sortColumn === columnKey
        ? sortDirection === 'asc'
          ? 'desc'
          : sortDirection === 'desc'
            ? null
            : 'asc'
        : 'asc';

    if (!isControlledSort) {
      setInternalSortColumn(nextDirection ? columnKey : null);
      setInternalSortDirection(nextDirection);
    }
    onSortChange?.(columnKey, nextDirection);
  };

  const handlePageChange = (page: number) => {
    if (!isControlledPage) setInternalPage(page);
    onPageChange?.(page);
  };

  const sortedData = React.useMemo(() => {
    if (!sortColumn || !sortDirection) return [...data];
    const column = columns.find((c) => c.key === sortColumn);
    if (!column) return [...data];

    const sorted = [...data].sort((a, b) => {
      const cmp = column.sortFn
        ? column.sortFn(a, b)
        : defaultSort(a, b, column.sortKey ?? column.key);
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortColumn, sortDirection, columns]);

  const totalPages = pageSize ? Math.ceil(sortedData.length / pageSize) : 1;
  const paginatedData = pageSize
    ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedData;

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortColumn !== colKey) return <ChevronsUpDown className="ml-1 h-4 w-4 opacity-50" />;
    return sortDirection === 'asc' ? (
      <ChevronUp className="ml-1 h-4 w-4" />
    ) : (
      <ChevronDown className="ml-1 h-4 w-4" />
    );
  };

  const renderTable = (items: T[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.sortable ? (
                <button
                  type="button"
                  onClick={() => handleSort(column.key)}
                  className="inline-flex items-center font-medium hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  aria-sort={
                    sortColumn === column.key
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {column.header}
                  <SortIcon colKey={column.key} />
                </button>
              ) : (
                column.header
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => (
          <TableRow
            key={keyExtractor(item, index)}
            className={onRowClick ? 'cursor-pointer' : undefined}
            onClick={() => onRowClick?.(item)}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.cell(item, index)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (isLoading) {
    return (
      <div className={cn('rounded-md border', className)} {...props}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column.key}>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn('rounded-md border', className)} {...props}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        </Table>
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)} {...props}>
      <div className="rounded-md border overflow-hidden">
        {renderTable(paginatedData)}
      </div>
      {pageSize && showPagination && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            showFirstLast
          />
        </div>
      )}
    </div>
  );
}

export {
  DataTable,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
