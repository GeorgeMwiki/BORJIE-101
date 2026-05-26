/**
 * @borjie/chat-ui — Borjie floating chat widget public surface.
 *
 * Mounted by `apps/marketing`, `apps/owner-web`, and `apps/admin-web`
 * via the `FloatingAskBorjie` React component. See the JSDoc on each
 * exported file for behavioural details.
 */
export {
  FloatingAskBorjie,
  BORJIE_FAB_LABEL,
} from './FloatingAskBorjie';
export type {
  FloatingAskBorjieProps,
  FloatingAskBorjieVariant,
} from './FloatingAskBorjie';
export {
  BorjieChatPanel,
  BORJIE_BRAND_EN,
  BORJIE_BRAND_SW,
  BORJIE_INTRO_EN,
  BORJIE_INTRO_SW,
} from './BorjieChatPanel';
export { BorjieChatBubble } from './BorjieChatBubble';
export {
  BorjieModeSelector,
  BORJIE_MODES,
  BORJIE_MODE_LABELS,
  modeLabel,
} from './BorjieModeSelector';
export { useBorjieChat } from './useBorjieChat';
export type {
  BorjieMode,
  BorjieLanguage,
  BorjieRole,
  BorjieMessage,
  BorjieJuniorCall,
  BorjieSendOptions,
  UseBorjieChatOptions,
  UseBorjieChatResult,
} from './useBorjieChat';
