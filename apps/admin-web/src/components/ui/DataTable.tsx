/**
 * DataTable primitive — generic re-export.
 *
 * The actual implementation lives at `components/internal/DataTable.tsx`
 * (built on TanStack Table: sortable headers, hover rows, keyboard
 * activation). This file is the LitFin-parity primitive surface so
 * non-internal admin pages can import a stable `@/components/ui/...`
 * path instead of reaching into the legacy `internal/` folder.
 */

export { DataTable } from '@/components/internal/DataTable';
