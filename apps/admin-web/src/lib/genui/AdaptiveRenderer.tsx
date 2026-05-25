/**
 * Re-export shim — kept so existing admin-web imports
 * (`@/lib/genui/AdaptiveRenderer`) continue to resolve. The renderer
 * + every primitive now lives in `@borjie/genui`, shared with the
 * owner-portal, customer-app and estate-manager-app portals.
 */
export { AdaptiveRenderer } from '@borjie/genui';
export type {
  AdaptiveRendererProps,
  AdaptiveRendererSingleProps,
  AdaptiveRendererListProps,
} from '@borjie/genui';
