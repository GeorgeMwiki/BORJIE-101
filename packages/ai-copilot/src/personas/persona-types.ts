/**
 * Borjie AI Persona Types (portal-bound primary personae).
 *
 * A primary persona is the IDENTITY the LLM inhabits on a specific portal
 * surface. The persona defines WHO the AI is, WHAT it may call, and HOW
 * it communicates. The LLM generates every response dynamically - the
 * prompt is a character sheet, not a flow chart.
 *
 * Structure inherited from a pre-fork lineage and adapted to Borjie's
 * estate-management domain; evolved independently. Borjie has SIX
 * primary portal-bound personae; a differential sub-persona prompt layer
 * stacks on top based on context signals (route, message keywords,
 * emotional tone, session metrics).
 */

/**
 * All Borjie surfaces. Each surface maps deterministically to exactly
 * one primary persona; the router does no LLM classification.
 */
export type PortalId =
  | 'admin-portal'
  | 'estate-manager-app'
  | 'customer-app'
  | 'owner-portal'
  | 'studio'
  | 'marketing';

/**
 * Canonical primary-persona identifiers.
 */
export type BorjiePersonaId =
  | 'manager-chat'
  | 'coworker'
  | 'tenant-assistant'
  | 'owner-advisor'
  | 'borjie-studio'
  | 'public-guide';

/**
 * Portal -> primary persona deterministic map.
 * Deterministic portal->persona map — zero LLM cost, O(1) lookup
 * (structure inherited from the pre-fork lineage; evolved independently).
 */
export const PORTAL_PERSONA_MAP: Readonly<Record<PortalId, BorjiePersonaId>> = {
  'admin-portal': 'manager-chat',
  'estate-manager-app': 'coworker',
  'customer-app': 'tenant-assistant',
  'owner-portal': 'owner-advisor',
  studio: 'borjie-studio',
  marketing: 'public-guide',
};

/**
 * Communication-style hints injected into the prompt context.
 * Named PersonaCommunicationStyle to avoid collision with the
 * CommunicationStyle enum in services/preference-profile-engine.
 */
export interface PersonaCommunicationStyle {
  readonly defaultTone: 'professional' | 'friendly' | 'technical' | 'supportive';
  readonly verbosity: 'concise' | 'moderate' | 'detailed';
  readonly formality: 'formal' | 'moderate' | 'casual';
  readonly usesEmoji: boolean;
  readonly supportsSwahili: boolean;
}

/**
 * A Borjie primary persona - the identity + capabilities for a
 * specific portal. Immutable shape; factories return frozen values.
 */
export interface BorjiePersona {
  /** Unique identifier (kebab-case). */
  readonly id: BorjiePersonaId;
  /** Human-readable name shown in the widget. */
  readonly displayName: string;
  /** Which portal this persona serves. */
  readonly portalId: PortalId;
  /**
   * The system prompt that defines who the AI is. IDENTITY, not a script.
   * Tells the LLM:
   *  - Who it is (character, expertise, experience)
   *  - How it thinks (frameworks, perspectives)
   *  - How it communicates (tone, style, language)
   *  - What it cares about (owner success, tenant dignity, compliance)
   */
  readonly systemPrompt: string;
  /** Tool names this persona may call (subset of registered dispatchers). */
  readonly availableTools: ReadonlyArray<string>;
  /** Communication-style hints injected into context. */
  readonly communicationStyle: PersonaCommunicationStyle;
}
