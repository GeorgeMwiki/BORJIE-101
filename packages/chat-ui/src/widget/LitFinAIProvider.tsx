'use client';

/**
 * Borjie AI Provider — carbon copy of LitFin's LitFinAIProvider,
 * Borjie-skinned.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/providers/LitFinAIProvider.tsx
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
  type JSX,
} from 'react';

export type LitFinPortalId =
  | 'public'
  | 'owner'
  | 'estate-manager'
  | 'customer'
  | 'admin';
export type LitFinPersonaId =
  | 'public-chat'
  | 'owner-advisor'
  | 'estate-manager-chat'
  | 'tenant-assistant'
  | 'admin-analyst';

const PORTAL_PERSONA_MAP: Readonly<Record<LitFinPortalId, LitFinPersonaId>> = {
  public: 'public-chat',
  owner: 'owner-advisor',
  'estate-manager': 'estate-manager-chat',
  customer: 'tenant-assistant',
  admin: 'admin-analyst',
};

const PAGEDATA_STORAGE_PREFIX = 'bn-litfin-pagedata-';

function getStoredPageData(
  portalId: LitFinPortalId,
): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(`${PAGEDATA_STORAGE_PREFIX}${portalId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function persistPageData(
  portalId: LitFinPortalId,
  data: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      `${PAGEDATA_STORAGE_PREFIX}${portalId}`,
      JSON.stringify(data),
    );
  } catch {
    /* ignore */
  }
}

interface LitFinAIContextValue {
  readonly portalId: LitFinPortalId;
  readonly currentRoute: string;
  readonly personaId: LitFinPersonaId;
  readonly isOpen: boolean;
  readonly pageData: Record<string, unknown>;
  readonly endpoint: string;
  /**
   * Domain-specific compliance copy shown in the bottom footer of the
   * chat panel. Borjie mounts pass the mining-domain "mine owner"
   * variant; BossNyumba mounts pass the real-estate "landlord"
   * variant. Missing → the panel renders a generic "owner" fallback.
   *
   * Typed as `string | undefined` (not optional) so the literal
   * context object satisfies `exactOptionalPropertyTypes: true` even
   * when the consumer omits the prop.
   */
  readonly disclaimerEn: string | undefined;
  readonly disclaimerSw: string | undefined;
  readonly toggleWidget: () => void;
  readonly openWidget: () => void;
  readonly closeWidget: () => void;
  readonly registerPageData: (data: Record<string, unknown>) => void;
}

const LitFinAIContext = createContext<LitFinAIContextValue | null>(null);

export interface LitFinAIProviderProps {
  readonly portalId: LitFinPortalId;
  readonly initialRoute?: string;
  readonly endpoint?: string;
  /**
   * Bilingual compliance copy injected into LitFinChatPanel's footer.
   * Borjie passes the mining "mine owner" variant; BossNyumba passes
   * the real-estate "landlord" variant. Keeps the panel domain-agnostic
   * while making the domain choice explicit at the mount boundary so
   * unrelated edits cannot silently swap copy.
   */
  readonly disclaimerEn?: string;
  readonly disclaimerSw?: string;
  readonly children: ReactNode;
}

export function LitFinAIProvider({
  portalId,
  initialRoute = '/',
  endpoint = '/api/chat',
  disclaimerEn,
  disclaimerSw,
  children,
}: LitFinAIProviderProps): JSX.Element {
  const [currentRoute, setCurrentRoute] = useState<string>(initialRoute);
  const [isOpen, setIsOpen] = useState(false);
  const [pageData, setPageData] = useState<Record<string, unknown>>({});
  const pageDataInitialized = useRef(false);

  const personaId = PORTAL_PERSONA_MAP[portalId];

  useEffect(() => {
    if (pageDataInitialized.current) return;
    pageDataInitialized.current = true;
    const stored = getStoredPageData(portalId);
    if (Object.keys(stored).length > 0) {
      setPageData(stored);
    }
  }, [portalId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateRoute = () => setCurrentRoute(window.location.pathname);
    updateRoute();
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('bn-litfin-open-chat', handleOpen);
    return () => window.removeEventListener('bn-litfin-open-chat', handleOpen);
  }, []);

  const toggleWidget = useCallback(() => setIsOpen((prev) => !prev), []);
  const openWidget = useCallback(() => setIsOpen(true), []);
  const closeWidget = useCallback(() => setIsOpen(false), []);

  const registerPageData = useCallback(
    (data: Record<string, unknown>) => {
      setPageData((prev) => {
        const merged = { ...prev, ...data };
        persistPageData(portalId, merged);
        return merged;
      });
    },
    [portalId],
  );

  const value = useMemo<LitFinAIContextValue>(
    () => ({
      portalId,
      currentRoute,
      personaId,
      isOpen,
      pageData,
      endpoint,
      disclaimerEn,
      disclaimerSw,
      toggleWidget,
      openWidget,
      closeWidget,
      registerPageData,
    }),
    [
      portalId,
      currentRoute,
      personaId,
      isOpen,
      pageData,
      endpoint,
      disclaimerEn,
      disclaimerSw,
      toggleWidget,
      openWidget,
      closeWidget,
      registerPageData,
    ],
  );

  return (
    <LitFinAIContext.Provider value={value}>{children}</LitFinAIContext.Provider>
  );
}

export function useLitFinAI(): LitFinAIContextValue {
  const ctx = useContext(LitFinAIContext);
  if (!ctx) {
    throw new Error('useLitFinAI must be used within a LitFinAIProvider');
  }
  return ctx;
}

export function useOptionalLitFinAI(): LitFinAIContextValue | null {
  return useContext(LitFinAIContext);
}
