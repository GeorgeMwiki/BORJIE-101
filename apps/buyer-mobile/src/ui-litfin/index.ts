/**
 * LitFin DNA — React Native primitives for buyer-mobile.
 *
 * These mirror the LitFin web design system (rounded-3xl cards,
 * gold-on-navy palette, Syne/Inter type ramp, pill buttons, gold-top
 * AI bubbles) so the Borjie Expo app reads visually identical to the
 * LitFin borrower portal.
 *
 * Import via:  `import { LitFinCard, tokens } from '@/ui-litfin'`
 */
export { tokens, type LitFinTokens } from './tokens'
export { greet, dayPart, type Daypart } from './greet'
export { LitFinCard, type LitFinCardProps, type LitFinCardTone } from './LitFinCard'
export {
  LitFinButton,
  type LitFinButtonProps,
  type LitFinButtonSize,
  type LitFinButtonVariant
} from './LitFinButton'
export { LitFinBadge, type LitFinBadgeProps, type LitFinBadgeTone } from './LitFinBadge'
export { LitFinAvatar, type LitFinAvatarProps } from './LitFinAvatar'
export { LitFinEmptyState, type LitFinEmptyStateProps } from './LitFinEmptyState'
export { LitFinChatBubble, type LitFinChatBubbleProps, type LitFinChatBubbleRole } from './LitFinChatBubble'
export { LitFinPageHero, type LitFinPageHeroProps } from './LitFinPageHero'
export { LitFinKpiTile, type LitFinKpiTileProps, type LitFinKpiTone } from './LitFinKpiTile'
export { LitFinThinkingDots } from './LitFinThinkingDots'
export {
  LitFinSkeleton,
  LitFinSkeletonStack,
  type LitFinSkeletonProps,
  type LitFinSkeletonStackProps
} from './LitFinSkeleton'
