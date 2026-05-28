/**
 * Owner-web Card barrel.
 *
 * Re-exports the canonical Card primitives from @borjie/design-system
 * so portal pages can import via the conventional `@/components/ui/Card`
 * path (mirroring LitFin's `@/components/ui/card` shape). The actual
 * implementation lives in the design system to keep the look
 * consistent across owner-web, admin-web, and marketing.
 */

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardImage,
  CardTitle,
  StatCard,
  type CardProps,
  type CardHeaderProps,
  type CardFooterProps,
  type CardImageProps,
  type CardTitleProps,
  type StatCardProps,
} from '@borjie/design-system';
