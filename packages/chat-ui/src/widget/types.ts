/**
 * Floating Chat Widget — type surface (BORJIE unified Mwikila widget).
 *
 * The widget is mounted once per app root and reads route + portal context
 * so the sub-persona router in the backend always has the right "muscle"
 * flexed for the current page. All state sits on BossnyumbaAIProvider so
 * page-level chat surfaces (ManagerChat, OwnerAdvisor, …) share one
 * conversation with the floating bubble.
 */
import type { Language } from '../chat-modes/types';

export type PortalId = 'customer' | 'estate-manager' | 'admin' | 'owner' | 'public';

export type PersonaId =
  | 'tenant-assistant'
  | 'coworker'
  | 'manager-chat'
  | 'owner-advisor'
  | 'public-chat';

export type SubPersona =
  | 'finance'
  | 'maintenance'
  | 'leasing'
  | 'compliance'
  | 'learning'
  | 'advisor'
  | 'general';

export type WidgetMode = 'collapsed' | 'expanded' | 'voice' | 'full';

export interface RouteContext {
  readonly path: string;
  readonly portal: PortalId;
  readonly entityMentions: readonly string[];
  readonly activeSubPersona: SubPersona;
}

export interface ChatAttachment {
  readonly id: string;
  readonly kind: 'image' | 'document';
  readonly name: string;
  readonly size: number;
  readonly previewUrl?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'mwikila';
  readonly text: string;
  readonly language: Language;
  readonly createdAt: string;
  readonly isStreaming?: boolean;
  readonly attachments?: readonly ChatAttachment[];
  readonly segmentId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ChatSegment {
  readonly id: string;
  readonly label: string;
  readonly startedAt: string;
  readonly subPersona: SubPersona;
}

export interface WidgetStrings {
  readonly greet: string;
  readonly placeholder: string;
  readonly send: string;
  readonly collapse: string;
  readonly expand: string;
  readonly mic: string;
  readonly micPermission: string;
  readonly unreadCount: string;
  readonly languageSwitched: string;
  readonly voiceError: string;
  readonly attachmentAccepted: string;
  readonly personaName: string;
}

export const DEFAULT_WIDGET_STRINGS_EN: WidgetStrings = {
  greet: 'Hi, I am Mr. Mwikila. How can I help with your estate today?',
  placeholder: 'Ask Mr. Mwikila anything…',
  send: 'Send',
  collapse: 'Collapse chat',
  expand: 'Open chat',
  mic: 'Hold to speak',
  micPermission: 'Microphone permission required',
  unreadCount: '{count} unread',
  languageSwitched: 'Switched to English',
  voiceError: 'Voice input unavailable',
  attachmentAccepted: 'Attachment received',
  personaName: 'Mr. Mwikila',
};

export const DEFAULT_WIDGET_STRINGS_SW: WidgetStrings = {
  greet: 'Habari, mimi ni Bw. Mwikila. Nikusaidieje leo?',
  placeholder: 'Muulize Bw. Mwikila chochote…',
  send: 'Tuma',
  collapse: 'Kunja gumzo',
  expand: 'Fungua gumzo',
  mic: 'Shikilia kuzungumza',
  micPermission: 'Ruhusa ya maikrofoni inahitajika',
  unreadCount: 'Ujumbe mpya {count}',
  languageSwitched: 'Imebadilishwa kwa Kiswahili',
  voiceError: 'Sauti haipatikani kwa sasa',
  attachmentAccepted: 'Kiambatisho kimepokelewa',
  personaName: 'Bw. Mwikila',
};

export interface SendOptions {
  readonly attachments?: readonly ChatAttachment[];
  readonly voice?: boolean;
}

export interface UnifiedChatState {
  readonly messages: readonly ChatMessage[];
  readonly segments: readonly ChatSegment[];
  readonly mode: WidgetMode;
  readonly isStreaming: boolean;
  readonly unreadCount: number;
  readonly language: Language;
  readonly persona: PersonaId;
  readonly route: RouteContext;
  readonly voiceEnabled: boolean;
  readonly soundsEnabled: boolean;
  readonly error: string | null;
  readonly sessionId: string;
  readonly tenantId: string | null;
}

export interface UnifiedChatActions {
  readonly sendMessage: (text: string, options?: SendOptions) => Promise<void>;
  readonly switchMode: (mode: WidgetMode) => void;
  readonly abort: () => void;
  readonly setLanguage: (lang: Language) => void;
  readonly toggleVoice: () => void;
  readonly toggleSounds: () => void;
  readonly clearUnread: () => void;
  readonly startSegment: (label: string, subPersona: SubPersona) => void;
}

export type UnifiedChat = UnifiedChatState & UnifiedChatActions;
