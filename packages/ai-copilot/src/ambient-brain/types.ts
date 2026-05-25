/**
 * Ambient Brain types
 *
 * The ambient layer makes Mr. Mwikila feel present across every portal —
 * subtle presence indicator, contextual tooltips, proactive interventions
 * that trigger when behavior signals cross thresholds.
 *
 * Ported from LitFin's ai-overlay (presence/observer/intervention triad),
 * recast for BORJIE estate-management workflows (owner/manager/tenant
 * portals; property, lease, arrears, maintenance screens).
 */

export type Portal = 'owner' | 'manager' | 'tenant' | 'agent' | 'admin';

export type OverlayMode =
  | 'hidden'
  | 'minimized'
  | 'floating'
  | 'sidebar'
  | 'fullscreen';

export type AssistanceMode = 'guide' | 'chat' | 'review' | 'search';

export type PageType =
  | 'dashboard'
  | 'property_list'
  | 'property_detail'
  | 'lease_form'
  | 'arrears_case'
  | 'maintenance_triage'
  | 'inspection_flow'
  | 'financials'
  | 'tenant_profile'
  | 'compliance'
  | 'other';

export interface PageContext {
  readonly pageId: string;
  readonly pageName: string;
  readonly pageType: PageType;
  readonly relevantFields: readonly string[];
  readonly availableActions: readonly PageAction[];
  readonly commonQuestions: readonly CommonQuestion[];
}

export interface PageAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly actionType:
    | 'navigate'
    | 'autofill'
    | 'generate'
    | 'validate'
    | 'explain';
  readonly enabled: boolean;
}

export interface CommonQuestion {
  readonly id: string;
  readonly question: string;
  readonly shortAnswer: string;
}

export interface PresenceState {
  readonly tenantId: string;
  readonly userId: string;
  readonly portal: Portal;
  readonly currentPage: string;
  readonly currentSection?: string;
  readonly overlayMode: OverlayMode;
  readonly assistanceMode: AssistanceMode;
  readonly isEngaged: boolean;
  readonly pageContext: PageContext;
  readonly lastInteractionAt: string;
}

export type BehaviorEventType =
  | 'field_focus'
  | 'field_blur'
  | 'field_error'
  | 'field_success'
  | 'form_submit_attempt'
  | 'idle'
  | 'navigation_back'
  | 'section_complete'
  | 'rapid_deletion'
  | 'help_hover';

export interface BehaviorEvent {
  readonly type: BehaviorEventType;
  readonly timestamp: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly fieldId?: string;
  readonly fieldName?: string;
  readonly sectionId?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

export type InterventionType =
  | 'offer_help'
  | 'provide_tip'
  | 'celebrate_progress'
  | 'explain_field'
  | 'confirm_action'
  | 'recommend_review'
  | 'suggest_break';

export interface ProactiveIntervention {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly type: InterventionType;
  readonly trigger: string;
  readonly priority: 'low' | 'medium' | 'high';
  readonly message: string;
  readonly messageSwahili?: string;
  readonly fieldId?: string;
  readonly sectionId?: string;
  readonly createdAt: string;
  readonly cooldownMs: number;
}

export interface ObserverConfig {
  readonly idleThresholdMs: number;
  readonly errorCountThreshold: number;
  readonly backtrackThreshold: number;
  readonly interventionCooldownMs: number;
  readonly maxInterventionsPerMinute: number;
}

export const DEFAULT_OBSERVER_CONFIG: ObserverConfig = {
  idleThresholdMs: 45_000,
  errorCountThreshold: 2,
  backtrackThreshold: 3,
  interventionCooldownMs: 60_000,
  maxInterventionsPerMinute: 3,
};
