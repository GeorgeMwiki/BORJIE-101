/**
 * AI Presence Manager
 *
 * Tracks which Mr. Mwikila persona is "present" on which screen for which
 * user, per tenant. Emits presence-change events so chat-ui (Agent C) can
 * render the subtle indicator, tooltips, and hints.
 *
 * Tenant-scoped: keys are always (tenantId, userId). Cross-tenant reads/writes
 * are impossible — the state map is partitioned by tenant.
 */

import { getPageContext } from './page-context-registry.js';
import type {
  AssistanceMode,
  OverlayMode,
  PageContext,
  Portal,
  PresenceState,
} from './types.js';

type PresenceListener = (state: PresenceState) => void;

interface StartArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly portal: Portal;
  readonly initialPage: string;
}

export class AIPresenceManager {
  private readonly states = new Map<string, PresenceState>();
  private readonly listeners = new Map<string, PresenceListener[]>();

  /** Initialise presence for a (tenant, user) pair. Returns the state. */
  start(args: StartArgs): PresenceState {
    const now = new Date().toISOString();
    const state: PresenceState = {
      tenantId: args.tenantId,
      userId: args.userId,
      portal: args.portal,
      currentPage: args.initialPage,
      overlayMode: 'floating',
      assistanceMode: 'guide',
      isEngaged: false,
      pageContext: getPageContext(args.initialPage),
      lastInteractionAt: now,
    };
    this.states.set(this.key(args.tenantId, args.userId), state);
    this.emit(state);
    return state;
  }

  updatePage(
    tenantId: string,
    userId: string,
    page: string,
    section?: string,
  ): PresenceState {
    const prev = this.requireState(tenantId, userId);
    const next: PresenceState = {
      ...prev,
      currentPage: page,
      currentSection: section,
      pageContext: getPageContext(page),
      lastInteractionAt: new Date().toISOString(),
    };
    this.states.set(this.key(tenantId, userId), next);
    this.emit(next);
    return next;
  }

  setOverlayMode(
    tenantId: string,
    userId: string,
    mode: OverlayMode,
  ): PresenceState {
    const prev = this.requireState(tenantId, userId);
    const next: PresenceState = { ...prev, overlayMode: mode };
    this.states.set(this.key(tenantId, userId), next);
    this.emit(next);
    return next;
  }

  setAssistanceMode(
    tenantId: string,
    userId: string,
    mode: AssistanceMode,
  ): PresenceState {
    const prev = this.requireState(tenantId, userId);
    const next: PresenceState = { ...prev, assistanceMode: mode };
    this.states.set(this.key(tenantId, userId), next);
    this.emit(next);
    return next;
  }

  setEngaged(
    tenantId: string,
    userId: string,
    engaged: boolean,
  ): PresenceState {
    const prev = this.requireState(tenantId, userId);
    const next: PresenceState = {
      ...prev,
      isEngaged: engaged,
      lastInteractionAt: engaged ? new Date().toISOString() : prev.lastInteractionAt,
    };
    this.states.set(this.key(tenantId, userId), next);
    this.emit(next);
    return next;
  }

  getState(tenantId: string, userId: string): PresenceState | null {
    return this.states.get(this.key(tenantId, userId)) ?? null;
  }

  /** Subscribe to presence changes for a (tenant, user). Returns unsubscribe. */
  subscribe(
    tenantId: string,
    userId: string,
    listener: PresenceListener,
  ): () => void {
    const key = this.key(tenantId, userId);
    const list = this.listeners.get(key) ?? [];
    this.listeners.set(key, [...list, listener]);
    return () => {
      const current = this.listeners.get(key) ?? [];
      this.listeners.set(
        key,
        current.filter((l) => l !== listener),
      );
    };
  }

  /** Build contextual help payload for the current page. */
  getContextualHelp(
    tenantId: string,
    userId: string,
  ): ContextualHelp | null {
    const state = this.getState(tenantId, userId);
    if (!state) return null;
    return {
      title: state.pageContext.pageName,
      description: describePage(state.pageContext),
      quickActions: state.pageContext.availableActions
        .filter((a) => a.enabled)
        .slice(0, 4),
      commonQuestions: state.pageContext.commonQuestions.slice(0, 3),
    };
  }

  /** Clear presence for a user (on logout or session expiry). */
  clear(tenantId: string, userId: string): void {
    this.states.delete(this.key(tenantId, userId));
    this.listeners.delete(this.key(tenantId, userId));
  }

  private key(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }

  private requireState(tenantId: string, userId: string): PresenceState {
    const state = this.getState(tenantId, userId);
    if (!state) {
      throw new Error(
        `AIPresenceManager: no presence for tenant=${tenantId} user=${userId}`,
      );
    }
    return state;
  }

  private emit(state: PresenceState): void {
    const key = this.key(state.tenantId, state.userId);
    const list = this.listeners.get(key) ?? [];
    for (const listener of list) {
      try {
        listener(state);
      } catch {
        // listener error ignored — presence is best-effort.
      }
    }
  }
}

export interface ContextualHelp {
  readonly title: string;
  readonly description: string;
  readonly quickActions: readonly PageContext['availableActions'][number][];
  readonly commonQuestions: readonly PageContext['commonQuestions'][number][];
}

function describePage(ctx: PageContext): string {
  const descriptions: Record<PageContext['pageType'], string> = {
    dashboard: 'Habari! I can summarise your portfolio in one minute.',
    property_list: 'Let me help you filter and prioritise properties.',
    property_detail: 'I have this property loaded — ask me anything about it.',
    lease_form: 'I can auto-fill parts of this lease from the tenant profile.',
    arrears_case: 'I can recommend the next step and draft notices for you.',
    maintenance_triage: 'I rank tickets and suggest vendors.',
    inspection_flow: 'I will walk you through the inspection checklist.',
    financials: 'I can explain any figure or variance on this page.',
    tenant_profile: 'Ask me about this tenant\u2019s history and risk signals.',
    compliance: 'I track renewals and upcoming expiries.',
    other: 'How can I help?',
  };
  return descriptions[ctx.pageType];
}
