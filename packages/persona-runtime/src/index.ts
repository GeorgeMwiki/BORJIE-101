/**
 * @borjie/persona-runtime — Piece D of the BORJIE master plan.
 *
 * Public surface:
 *
 *   types            — Zod schemas + TS types for Persona, Title,
 *                       PersonaBinding, AuthorizationContext, etc.
 *   tool-catalog     — `computeToolCatalog()` — kill-switch +
 *                       channel + feature-flag + max_action_tier filter
 *   scope-predicate  — pure scope evaluator + filter renderer
 *   binding-resolver — default persona resolution + active persona
 *                       session store + tier compatibility check
 *   seeds            — built-in titles, personas, and the
 *                       `seedBuiltInTitlesAndPersonas()` helper
 */

// ── Types ────────────────────────────────────────────────────────────
export {
  ACTION_TIERS,
  ActionTierSchema,
  AuthorizationContextSchema,
  CHANNELS,
  ChannelSchema,
  POWER_TIERS,
  POWER_TIER_LABEL,
  PowerTierSchema,
  PersonaSchema,
  PersonaBindingSchema,
  TitleSchema,
  ScopePredicateSchema,
  MemoryNamespaceSchema,
  TICKET_STATUSES,
  TicketSchema,
  SCOPE_KINDS,
  isActionTierAllowed,
} from './types.js';

export type {
  ActionTier,
  AuthorizationContext,
  Channel,
  PowerTier,
  Persona,
  PersonaBinding,
  Title,
  ScopePredicate,
  ScopeKind,
  MemoryNamespace,
  TicketStatus,
  Ticket,
} from './types.js';

// ── Tool catalog ─────────────────────────────────────────────────────
export {
  computeToolCatalog,
  FEATURE_FLAG_PREFIX,
} from './tool-catalog.js';

export type {
  ComputeToolCatalogArgs,
  ComputeToolCatalogResult,
  ToolDescriptor,
  ToolDescriptorMap,
} from './tool-catalog.js';

// ── Scope predicate ──────────────────────────────────────────────────
export {
  evaluateScopePredicate,
  renderScopeFilter,
} from './scope-predicate.js';

export type {
  ScopeEvaluationResult,
  ScopeFilter,
  ScopeTargetRow,
} from './scope-predicate.js';

// ── Binding resolver ─────────────────────────────────────────────────
export {
  resolveDefaultPersonaForUser,
  setActivePersona,
  getActivePersona,
  validateBindingTierCompatibility,
  createInMemorySessionStore,
} from './binding-resolver.js';

export type {
  ActivePersonaSessionStore,
  BindingTierVerdict,
  PersonaBindingPort,
  ResolvedDefaultPersona,
} from './binding-resolver.js';

// ── Seeds ────────────────────────────────────────────────────────────
export {
  BUILT_IN_TITLES,
  BUILT_IN_PERSONAS,
  renderMemoryNamespaceKey,
  seedBuiltInTitlesAndPersonas,
} from './seeds.js';

export type {
  BuiltInPersonaSpec,
  BuiltInTitleSpec,
  RenderTemplateArgs,
  SeedPort,
  SeedResult,
} from './seeds.js';

// ── Workforce tab catalog (fixed tabs, owner-driven visibility) ──────
export {
  WORKFORCE_ROLE_IDS,
  WORKFORCE_TAB_CATALOG,
  MANDATORY_WORKFORCE_TAB_IDS,
  listTabsAllowedForRole,
  defaultEnabledTabIdsForRole,
  validateEnabledTabsForRole,
} from './workforce-tab-catalog.js';

export type {
  WorkforceRoleId,
  WorkforceTabId,
  WorkforceTabSpec,
} from './workforce-tab-catalog.js';

// ── Mobile slash-command catalog (workforce + buyer) ─────────────────
export {
  WORKFORCE_SLASH_COMMANDS,
  BUYER_SLASH_COMMANDS,
  slashCommandsForPersona,
} from './slash-commands.js';

export type { MobileSlashCommand } from './slash-commands.js';

// ── AI suggestion chip (manager-dispatch SOTA §6) ────────────────────
export {
  AI_SUGGESTION_MIN_CONFIDENCE,
  AI_SUGGESTION_PREFILL_CONFIDENCE,
  deriveAiSuggestionChip,
} from './ai-suggestion-chip.js';

export type {
  AiSuggestionChipInput,
  AiSuggestionChipText,
  AiSuggestionRoute,
} from './ai-suggestion-chip.js';
