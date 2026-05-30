export * from './types';
export * from './route-context';
export { useUnifiedChat, buildAttachment } from './useUnifiedChat';
export type { UseUnifiedChatOptions } from './useUnifiedChat';
export { useWidgetLanguage } from './useWidgetLanguage';
export type { UseWidgetLanguageResult } from './useWidgetLanguage';
export { useChatSounds } from './useChatSounds';
export type { ChatSoundKind, UseChatSoundsResult } from './useChatSounds';
export { useMessageWindow } from './useMessageWindow';
export type {
  MessageWindowOptions,
  MessageWindowResult,
} from './useMessageWindow';
export {
  BorjieAIProvider,
  useBorjieAI,
  useOptionalBorjieAI,
} from './BorjieAIProvider';
export type { BorjieAIProviderProps } from './BorjieAIProvider';
export { ChatPanel } from './ChatPanel';
export { MessageBubble } from './MessageBubble';
export { ContextBadge } from './ContextBadge';
export { SegmentHeader } from './SegmentHeader';
export { WaveformVisualizer } from './WaveformVisualizer';
export { VoiceOverlay } from './VoiceOverlay';
export { FloatingChatWidget } from './FloatingChatWidget';
export { renderMarkdown, escapeHtml } from './markdown';
// LitFin-clone Widget — full FAB pulse + tooltip + chips + lazy ChatPanel.
// Carbon-copy port of LitFinWidget.tsx with Borjie brand swapped in.
export { Widget } from './Widget';
export type { WidgetProps } from './Widget';
export { WidgetErrorBoundary } from './WidgetErrorBoundary';
export {
  getWidgetWelcomeMessage,
  getWidgetSuggestionChips,
} from './widget-content';
export type {
  WidgetLanguage as WidgetContentLanguage,
  WidgetSuggestionChip,
} from './widget-content';
