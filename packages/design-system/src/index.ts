/**
 * @borjie/design-system
 *
 * Borjie — shared UI component library.
 * React + TypeScript + Tailwind + Radix.
 *
 * Wave 29: established the "Midnight Ledger + Cinematic Display"
 * direction — near-black foundation, warm amber signal, editorial
 * display type.
 */

// ============================================================================
// Utilities
// ============================================================================
export * from './lib/utils';
export { cn } from './lib/utils';

// ============================================================================
// Brand — logomark, wordmark, brand constants
// ============================================================================
export * from './brand/index';

// ============================================================================
// Core Components
// ============================================================================

// Button
export {
  Button,
  ButtonGroup,
  buttonVariants,
  type ButtonProps,
  type ButtonGroupProps,
} from './components/Button';

// Input & Textarea
export {
  Input,
  Textarea,
  type InputProps,
  type InputType,
  type TextareaProps,
} from './components/Input';

// Select (Basic, Searchable, Multi-select)
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
  type SearchableSelectOption,
  type SearchableSelectProps,
  type MultiSelectProps,
} from './components/Select';

// Modal
export {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ConfirmationModal,
  type ModalProps,
  type ModalHeaderProps,
  type ModalBodyProps,
  type ModalFooterProps,
  type ConfirmationModalProps,
} from './components/Modal';

// Table
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  SortableTable,
  type TableProps,
  type TableHeaderProps,
  type TableBodyProps,
  type TableFooterProps,
  type TableRowProps,
  type TableHeadProps,
  type TableCellProps,
  type TableCaptionProps,
  type SortableColumn,
  type SortableTableProps,
  type SortDirection,
} from './components/Table';

// Card
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  CardImage,
  StatCard,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardFooterProps,
  type CardImageProps,
  type StatCardProps,
} from './components/Card';

// Badge
export {
  Badge,
  StatusBadge,
  BadgeGroup,
  badgeVariants,
  type BadgeProps,
  type StatusBadgeProps,
  type StatusType,
  type BadgeGroupProps,
} from './components/Badge';

// Alert
export {
  Alert,
  AlertTitle,
  AlertDescription,
  InlineAlert,
  BannerAlert,
  alertVariants,
  type AlertProps,
  type InlineAlertProps,
  type BannerAlertProps,
} from './components/Alert';

// Tabs
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  SimpleTabs,
  VerticalTabs,
  type TabItem,
  type SimpleTabsProps,
  type VerticalTabsProps,
} from './components/Tabs';

// Sidebar
export {
  Sidebar,
  MobileSidebar,
  SidebarToggle,
  SidebarSection,
  type SidebarProps,
  type SidebarItem,
  type SidebarSection as SidebarSectionType,
  type MobileSidebarProps,
  type SidebarToggleProps,
  type SidebarSectionProps,
} from './components/Sidebar';

// DataGrid
export {
  DataGrid,
  SimpleDataGrid,
  type DataGridProps,
  type SimpleDataGridProps,
  type Column,
  type FilterConfig,
} from './components/DataGrid';

// ============================================================================
// Additional Components
// ============================================================================

// Label
export * from './components/Label';

// Dialog (Radix-based)
export * from './components/Dialog';

// Drawer (Radix-based, side panel)
export * from './components/Drawer';

// Popover (Radix-based, anchored floating panel)
export * from './components/Popover';

// Dropdown & DropdownMenu
export * from './components/Dropdown';
export * from './components/DropdownMenu';

// Breadcrumb
export * from './components/Breadcrumb';

// Keyboard hint chip
export { Kbd, kbdVariants, type KbdProps } from './components/Kbd';

// Search input
export { SearchInput, type SearchInputProps } from './components/SearchInput';

// Toast
export * from './components/Toast';
export {
  useToast,
  toast,
  Toaster,
  type ToastOptions,
  type UseToastReturn,
} from './components/useToast';

// Tooltip
export * from './components/Tooltip';

// Separator
export * from './components/Separator';

// Avatar
export * from './components/Avatar';

// Skeleton
export * from './components/Skeleton';

// Spinner
export * from './components/Spinner';

// ErrorBoundary
export { ErrorBoundary } from './components/ErrorBoundary';

// Pagination
export * from './components/Pagination';

// Progress
export * from './components/Progress';

// Empty State
export * from './components/Empty';

// Header
export * from './components/Header';

// Stat
export * from './components/Stat';

// ============================================================================
// Layout Components
// ============================================================================

export * from './components/layout/Container';

// ============================================================================
// Form Components
// ============================================================================

export * from './components/form/FormField';
export * from './components/form/ZodForm';

// ============================================================================
// Data Display Components
// ============================================================================

export * from './components/data/DataTable';
export * from './components/data/StatCard';
export * from './components/data/EmptyState';
export {
  ScrubbableChart,
  type ScrubbableChartProps,
  type ScrubbableSeries,
  type ScrubbableHeaderArgs,
  type ScrubbableChartColor,
} from './components/data/ScrubbableChart';
