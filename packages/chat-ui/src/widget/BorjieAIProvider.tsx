/**
 * BorjieAIProvider — single source of truth for all chat UI.
 *
 * Mounted at the root of each portal app. Page-level surfaces
 * (ManagerChat, OwnerAdvisor …) read from the same context so the floating
 * widget and the full-page chat share a conversation.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Language } from '../chat-modes/types';
import {
  DEFAULT_WIDGET_STRINGS_EN,
  DEFAULT_WIDGET_STRINGS_SW,
  type PersonaId,
  type PortalId,
  type UnifiedChat,
  type WidgetStrings,
} from './types';
import { buildRouteContext } from './route-context';
import { useUnifiedChat } from './useUnifiedChat';
import { useWidgetLanguage } from './useWidgetLanguage';

interface BorjieAIContextValue {
  readonly chat: UnifiedChat;
  readonly strings: WidgetStrings;
  readonly featureEnabled: boolean;
}

const BorjieAIContext = createContext<BorjieAIContextValue | null>(null);

export interface BorjieAIProviderProps {
  readonly children: ReactNode;
  readonly portal: PortalId;
  readonly defaultPersona: PersonaId;
  readonly defaultLanguage?: Language;
  readonly currentPath?: string;
  readonly tenantId?: string | null;
  readonly featureEnabled?: boolean;
  readonly endpoint?: string;
  readonly strings?: {
    readonly en?: Partial<WidgetStrings>;
    readonly sw?: Partial<WidgetStrings>;
  };
}

export function BorjieAIProvider({
  children,
  portal,
  defaultPersona,
  defaultLanguage = 'en',
  currentPath = '/',
  tenantId = null,
  featureEnabled = true,
  endpoint,
  strings,
}: BorjieAIProviderProps): JSX.Element {
  const { language, setLanguage } = useWidgetLanguage(defaultLanguage);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);

  const route = useMemo(() => buildRouteContext(currentPath, portal), [currentPath, portal]);

  const chat = useUnifiedChat({
    endpoint,
    persona: defaultPersona,
    tenantId,
    language,
    setLanguage,
    route,
    soundsEnabled,
    setSoundsEnabled,
    voiceEnabled,
    setVoiceEnabled,
  });

  const mergedStrings = useMemo<WidgetStrings>(() => {
    const base = language === 'sw' ? DEFAULT_WIDGET_STRINGS_SW : DEFAULT_WIDGET_STRINGS_EN;
    const override = language === 'sw' ? strings?.sw : strings?.en;
    return { ...base, ...(override ?? {}) };
  }, [language, strings]);

  const value = useMemo<BorjieAIContextValue>(
    () => ({ chat, strings: mergedStrings, featureEnabled }),
    [chat, mergedStrings, featureEnabled],
  );

  return <BorjieAIContext.Provider value={value}>{children}</BorjieAIContext.Provider>;
}

export function useBorjieAI(): BorjieAIContextValue {
  const ctx = useContext(BorjieAIContext);
  if (!ctx) {
    throw new Error('useBorjieAI must be used inside BorjieAIProvider');
  }
  return ctx;
}

export function useOptionalBorjieAI(): BorjieAIContextValue | null {
  return useContext(BorjieAIContext);
}
