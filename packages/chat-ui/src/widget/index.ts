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
// The legacy `Widget` export was removed: only `LitFinWidget` (below) is a
// mountable floating widget, so there is no second skeleton path to flash on
// chunk-load. No live consumer imported `Widget`/`WidgetProps`.
export { WidgetErrorBoundary } from './WidgetErrorBoundary';
export {
  getWidgetWelcomeMessage,
  getWidgetSuggestionChips,
} from './widget-content';
export type {
  WidgetLanguage as WidgetContentLanguage,
  WidgetSuggestionChip,
} from './widget-content';

// ---------------------------------------------------------------------------
// LitFin verbatim panel suite — full ChatPanel + MessageBubble +
// ContextBadge + SegmentHeader + AIMessageText + Provider. Mirrors
// `feat/litfin-widget-clone-fresh` on BossNyumba — same surface, Borjie
// branded. Coexists with legacy `ChatPanel`/`MessageBubble` above; new
// mounts should prefer `LitFinChatPanel` behind `LitFinAIProvider`.
// ---------------------------------------------------------------------------
export { LitFinWidget } from './LitFinWidget';
export { LitFinChatPanel } from './LitFinChatPanel';
export {
  LitFinVoiceCapture,
  nextVisualState as litfinVoiceNextVisualState,
} from './LitFinVoiceCapture';
export type {
  LitFinVoiceCaptureProps,
  VoiceCaptureVisualState,
  VoiceCaptureEvent,
} from './LitFinVoiceCapture';
export {
  LitFinAIProvider,
  useLitFinAI,
  useOptionalLitFinAI,
} from './LitFinAIProvider';
export type {
  LitFinAIProviderProps,
  LitFinPortalId,
  LitFinPersonaId,
} from './LitFinAIProvider';
export { LitFinMessageBubble } from './LitFinMessageBubble';
export type { LitFinMessage } from './LitFinMessageBubble';
export { LitFinContextBadge } from './LitFinContextBadge';
export { LitFinSegmentHeader } from './LitFinSegmentHeader';
export { AIMessageText } from './AIMessageText';
export {
  getWidgetWelcomeMessage as getLitFinWidgetWelcomeMessage,
  getWidgetSuggestionChips as getLitFinWidgetSuggestionChips,
} from './litfin-widget-content';
export type {
  WidgetLanguage as LitFinWidgetLanguage,
  WidgetPortalId as LitFinWidgetPortalId,
  WidgetSuggestionChip as LitFinWidgetSuggestionChip,
} from './litfin-widget-content';
