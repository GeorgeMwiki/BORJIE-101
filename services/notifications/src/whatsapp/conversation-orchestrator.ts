/**
 * Conversation Orchestrator for BORJIE
 * Handles multi-step conversational flows via WhatsApp
 * Implements Module A (Onboarding) workflows
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger.js';
import { MetaWhatsAppClient } from './meta-client.js';
import {
  ONBOARDING_TEMPLATES,
  GENERAL_TEMPLATES,
  renderTemplate,
  getTemplate,
  detectLanguage,
  getPhoneExampleForCountry,
} from './templates.js';
import type {
  ConversationSession,
  ConversationState,
  ConversationContext,
  OnboardingContext,
  SupportedLanguage,
  IncomingMessage,
  InteractiveReply,
  MessageHistoryItem,
} from './types.js';

const logger = createLogger('ConversationOrchestrator');

/**
 * Thrown when an outbound WhatsApp template cannot be rendered because
 * a required context field is missing. The previous code substituted a
 * literal `'TBD'` which silently shipped misleading copy to residents.
 *
 * Callers are expected to either backfill the field via the
 * orchestrator's state machine (preferred) or surface a structured
 * error to the operator console.
 */
export class TemplateContextIncomplete extends Error {
  readonly code = 'TEMPLATE_CONTEXT_INCOMPLETE';
  readonly templateId: string;
  readonly missingFields: ReadonlyArray<string>;
  constructor(templateId: string, missingFields: ReadonlyArray<string>) {
    super(
      `WhatsApp template ${templateId} cannot be rendered — missing required fields: ${missingFields.join(', ')}`,
    );
    this.name = 'TemplateContextIncomplete';
    this.templateId = templateId;
    this.missingFields = missingFields;
  }
}

/**
 * Round-3 audit C4 fix — the orchestrator previously bound
 * `tenantId: tenant?.tenantId || ''` which let the empty string flow
 * downstream into `findById('')` calls. Some DB layers reject the empty
 * string with a typed error; others (legacy in-memory stores) treat it
 * as a wildcard. Either way it's a silent cross-tenant or crash risk.
 *
 * Thrown by {@link assertTenantContext} when an operation that
 * structurally requires a non-empty `tenantId` is reached. Callers
 * MUST either route the message to a pre-onboarding "unknown sender"
 * flow OR fail-closed with a typed error logged for ops.
 */
export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';
  readonly phoneNumber: string;
  readonly operation: string;
  constructor(phoneNumber: string, operation: string) {
    super(
      `WhatsApp orchestrator: tenantId is required for "${operation}" — phone ${phoneNumber} is not bound to a tenant.`,
    );
    this.name = 'TenantContextMissingError';
    this.phoneNumber = phoneNumber;
    this.operation = operation;
  }
}

/**
 * Centralised tenant-id guard. Every code path that needs a tenant for
 * DB lookup, audit log, or template rendering MUST funnel through this
 * helper instead of `session.tenantId`. The previous codebase had ~12
 * touch points that read `session.tenantId` directly with no guard —
 * the cluster of bugs is the single biggest contributor to the
 * conversation-orchestrator's bug density (12 findings of 51).
 */
export function assertTenantContext(
  session: Pick<ConversationSession, 'tenantId' | 'phoneNumber'>,
  operation: string,
): string {
  const tenantId = session.tenantId?.trim() ?? '';
  if (!tenantId || isUnboundTenant(tenantId)) {
    throw new TenantContextMissingError(session.phoneNumber, operation);
  }
  return tenantId;
}

const UNBOUND_TENANT_PREFIX = 'unbound:';

/**
 * True iff a session's `tenantId` is the synthetic pre-onboarding tag
 * minted by {@link ConversationOrchestrator.createNewSession} when the
 * phone number is not bound to a real tenant.
 */
export function isUnboundTenant(tenantId: string | undefined | null): boolean {
  if (!tenantId) return true;
  return tenantId.startsWith(UNBOUND_TENANT_PREFIX);
}

/**
 * Round-3 audit M5 fix — `messageHistory.push` mutated the array
 * in place AND `slice(-50)` immediately replaced it, so concurrent
 * readers occasionally saw a half-mutated state. Immutable replace
 * here means each save is atomic from the orchestrator's POV.
 *
 * Also adds an explicit "[earlier history was trimmed]" sentinel
 * (audit 3.6) so any downstream LLM consumer can detect truncation
 * instead of seeing a smooth window with no marker.
 */
function appendHistoryImmutable(
  existing: ReadonlyArray<MessageHistoryItem>,
  item: MessageHistoryItem,
  windowSize: number,
): MessageHistoryItem[] {
  const next = [...existing, item];
  if (next.length <= windowSize) return next;

  const truncated = next.length - windowSize;
  const sentinel: MessageHistoryItem = {
    id: `__history_trimmed_${Date.now()}`,
    direction: 'inbound',
    type: 'text',
    content: `[${truncated} earlier message(s) trimmed]`,
    timestamp: new Date(),
    status: 'delivered',
  };
  // Drop the oldest entries and prepend a single sentinel so the
  // window always carries N items (sentinel + (N-1) most recent).
  return [sentinel, ...next.slice(-(windowSize - 1))];
}

// ============================================================================
// Session Store Interface
// ============================================================================

export interface SessionStore {
  get(phoneNumber: string): Promise<ConversationSession | null>;
  set(session: ConversationSession): Promise<void>;
  delete(phoneNumber: string): Promise<void>;
  getByTenantId(tenantId: string): Promise<ConversationSession | null>;
}

// ============================================================================
// In-Memory Session Store (for development)
// ============================================================================

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, ConversationSession>();
  private tenantIndex = new Map<string, string>();

  async get(phoneNumber: string): Promise<ConversationSession | null> {
    const session = this.sessions.get(phoneNumber);
    if (session && session.expiresAt > new Date()) {
      return session;
    }
    // Clean up expired session
    if (session) {
      this.sessions.delete(phoneNumber);
      if (session.tenantId) {
        this.tenantIndex.delete(session.tenantId);
      }
    }
    return null;
  }

  async set(session: ConversationSession): Promise<void> {
    this.sessions.set(session.phoneNumber, session);
    // Round-3 audit 2.8 fix: skip the tenant index when tenant is
    // unbound (pre-onboarding synthetic id). Otherwise every unknown
    // phone shares the same index slot.
    if (session.tenantId && !isUnboundTenant(session.tenantId)) {
      this.tenantIndex.set(session.tenantId, session.phoneNumber);
    }
  }

  async delete(phoneNumber: string): Promise<void> {
    const session = this.sessions.get(phoneNumber);
    if (session?.tenantId) {
      this.tenantIndex.delete(session.tenantId);
    }
    this.sessions.delete(phoneNumber);
  }

  async getByTenantId(tenantId: string): Promise<ConversationSession | null> {
    const phoneNumber = this.tenantIndex.get(tenantId);
    if (phoneNumber) {
      return this.get(phoneNumber);
    }
    return null;
  }
}

// ============================================================================
// Tenant Lookup Interface
// ============================================================================

export interface TenantLookup {
  findByPhone(phoneNumber: string): Promise<TenantInfo | null>;
  findById(tenantId: string): Promise<TenantInfo | null>;
  updateOnboardingStatus(tenantId: string, status: OnboardingStatus): Promise<void>;
}

export interface TenantInfo {
  tenantId: string;
  name: string;
  phoneNumber: string;
  email?: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  leaseStartDate?: string;
  onboardingStatus: OnboardingStatus;
  preferredLanguage?: SupportedLanguage;
  /**
   * ISO-3166-1 alpha-2 country code for the tenant's home market.
   * Used to resolve per-country examples in outbound copy (e.g. the
   * emergency-contact phone example). Optional so legacy lookups that
   * don't carry country information continue to compile; the
   * orchestrator falls back to a generic `+CC ...` placeholder.
   */
  country?: string;
}

export type OnboardingStatus = 
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

// ============================================================================
// Conversation Orchestrator
// ============================================================================

export class ConversationOrchestrator {
  private whatsappClient: MetaWhatsAppClient;
  private sessionStore: SessionStore;
  private tenantLookup: TenantLookup;
  private sessionTimeoutMinutes: number;

  constructor(options: {
    whatsappClient: MetaWhatsAppClient;
    sessionStore: SessionStore;
    tenantLookup: TenantLookup;
    sessionTimeoutMinutes?: number;
  }) {
    this.whatsappClient = options.whatsappClient;
    this.sessionStore = options.sessionStore;
    this.tenantLookup = options.tenantLookup;
    this.sessionTimeoutMinutes = options.sessionTimeoutMinutes || 30;
  }

  // ============================================================================
  // Main Message Handler
  // ============================================================================

  /**
   * Process an incoming message and generate appropriate response
   */
  async handleMessage(message: IncomingMessage, senderName?: string): Promise<void> {
    const phoneNumber = message.from;
    
    logger.info('Processing incoming message', { 
      from: phoneNumber, 
      type: message.type,
      messageId: message.id 
    });

    // Mark message as read
    await this.whatsappClient.markAsRead(message.id);

    // Get or create session
    let session = await this.sessionStore.get(phoneNumber);
    const tenant = await this.tenantLookup.findByPhone(phoneNumber);

    if (!session) {
      session = await this.createNewSession(phoneNumber, tenant, senderName);
    } else {
      // Update session activity
      session.updatedAt = new Date();
      session.expiresAt = this.getExpirationDate();
    }

    // Add message to history
    this.addToHistory(session, message);

    // Route to appropriate handler based on state
    await this.routeMessage(session, message, tenant);

    // Save updated session
    await this.sessionStore.set(session);
  }

  /**
   * Route message to appropriate handler based on conversation state
   */
  private async routeMessage(
    session: ConversationSession,
    message: IncomingMessage,
    tenant: TenantInfo | null
  ): Promise<void> {
    const state = session.state;
    const text = this.extractTextContent(message);

    // Check for emergency keywords first
    if (text && this.containsEmergencyKeyword(text, session.language)) {
      logger.warn('Emergency keyword detected', { from: session.phoneNumber, text });
      // Will be handled by EmergencyProtocolHandler
      return;
    }

    // Route based on state
    switch (state) {
      case 'idle':
        await this.handleIdleState(session, message, tenant, text);
        break;

      case 'onboarding_welcome':
      case 'onboarding_language':
        await this.handleLanguageSelection(session, message);
        break;

      case 'onboarding_move_in_date':
        await this.handleMoveInDate(session, text);
        break;

      case 'onboarding_occupants':
        await this.handleOccupantsResponse(session, message);
        break;

      case 'onboarding_emergency_contact':
        await this.handleEmergencyContact(session, text);
        break;

      case 'onboarding_confirmation':
        await this.handleOnboardingConfirmation(session, message, tenant);
        break;

      case 'awaiting_response':
        await this.handleGenericResponse(session, message, tenant, text);
        break;

      default:
        await this.handleUnknownState(session, message);
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  private async createNewSession(
    phoneNumber: string,
    tenant: TenantInfo | null,
    _senderName?: string
  ): Promise<ConversationSession> {
    // Round-3 audit C4: never bind tenantId to empty string. Sessions
    // for unrecognised phones get a tagged synthetic id
    // (`unbound:${phoneNumber}`) so downstream guards detect the
    // pre-onboarding state explicitly via `isUnboundTenant()` instead
    // of misreading `''` as a wildcard.
    const tenantId = tenant?.tenantId
      ? tenant.tenantId.trim() || `unbound:${phoneNumber}`
      : `unbound:${phoneNumber}`;

    const session: ConversationSession = {
      id: uuidv4(),
      tenantId,
      phoneNumber,
      state: 'idle',
      language: tenant?.preferredLanguage || 'en',
      context: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: this.getExpirationDate(),
      messageHistory: [],
    };

    logger.info('Created new conversation session', {
      sessionId: session.id,
      phoneNumber,
      tenantId,
      bound: !isUnboundTenant(tenantId),
    });

    return session;
  }

  private getExpirationDate(): Date {
    return new Date(Date.now() + this.sessionTimeoutMinutes * 60 * 1000);
  }

  private addToHistory(session: ConversationSession, message: IncomingMessage): void {
    const historyItem: MessageHistoryItem = {
      id: message.id,
      direction: 'inbound',
      type: message.type as MessageHistoryItem['type'],
      content: this.extractTextContent(message) || `[${message.type}]`,
      // Bug fix A-BUG-DEEP #10: parseInt requires radix.
      timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
      status: 'delivered',
    };
    // Round-3 audit M5 fix: immutable replace + truncation sentinel.
    session.messageHistory = appendHistoryImmutable(
      session.messageHistory,
      historyItem,
      50,
    );
  }

  private extractTextContent(message: IncomingMessage): string | null {
    switch (message.type) {
      case 'text':
        return message.text?.body || null;
      case 'interactive':
        return message.interactive?.button_reply?.title || 
               message.interactive?.list_reply?.title || null;
      case 'button':
        return message.button?.text || null;
      default:
        return null;
    }
  }

  private getInteractiveReplyId(message: IncomingMessage): string | null {
    if (message.type === 'interactive' && message.interactive) {
      return message.interactive.button_reply?.id || 
             message.interactive.list_reply?.id || null;
    }
    if (message.type === 'button' && message.button) {
      return message.button.payload;
    }
    return null;
  }

  // ============================================================================
  // State Handlers
  // ============================================================================

  private async handleIdleState(
    session: ConversationSession,
    message: IncomingMessage,
    tenant: TenantInfo | null,
    text: string | null
  ): Promise<void> {
    // Detect language from message
    if (text) {
      session.language = detectLanguage(text);
    }

    // Check if this is a known tenant who needs onboarding
    if (tenant && tenant.onboardingStatus === 'pending') {
      await this.startOnboarding(session, tenant);
      return;
    }

    // Check for specific commands
    if (text) {
      const lowerText = text.toLowerCase();
      
      if (lowerText.includes('maintenance') || lowerText.includes('matengenezo')) {
        // Route to maintenance handler (will be handled separately)
        session.state = 'maintenance_intake';
        return;
      }

      if (lowerText.includes('rent') || lowerText.includes('pay') || 
          lowerText.includes('kodi') || lowerText.includes('lipa')) {
        // Handle rent/payment inquiry
        await this.handlePaymentInquiry(session, tenant);
        return;
      }
    }

    // Default greeting for known tenant
    if (tenant) {
      const greeting = renderTemplate(
        getTemplate(GENERAL_TEMPLATES.greeting, session.language) as string,
        { tenantName: tenant.name }
      );
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: greeting });
    } else {
      // Unknown number
      const template = getTemplate(GENERAL_TEMPLATES.unknownCommand, session.language) as string;
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: template });
    }

    session.state = 'awaiting_response';
  }

  // ============================================================================
  // Onboarding Flow (Module A)
  // ============================================================================

  /**
   * Start the onboarding flow for a new tenant
   */
  async startOnboarding(session: ConversationSession, tenant: TenantInfo): Promise<void> {
    logger.info('Starting onboarding flow', { tenantId: tenant.tenantId });

    // Initialize onboarding context
    session.context.onboarding = {
      tenantName: tenant.name,
      propertyId: tenant.propertyId,
      unitId: tenant.unitId,
      step: 1,
      completedSteps: [],
    };

    // Send welcome message
    const welcomeMessage = renderTemplate(
      getTemplate(ONBOARDING_TEMPLATES.welcome, session.language) as string,
      { propertyName: tenant.propertyName }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: welcomeMessage });

    // Send language selection buttons
    const langTemplate = getTemplate(ONBOARDING_TEMPLATES.languageSelection, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (langTemplate as { body: string }).body,
      (langTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'onboarding_language';
    
    // Update tenant status
    await this.tenantLookup.updateOnboardingStatus(tenant.tenantId, 'in_progress');
  }

  private async handleLanguageSelection(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const replyId = this.getInteractiveReplyId(message);
    const text = this.extractTextContent(message)?.toLowerCase();

    // Determine language selection
    if (replyId === 'lang_sw' || text?.includes('swahili') || text?.includes('kiswahili')) {
      session.language = 'sw';
    } else {
      session.language = 'en';
    }

    // Update context
    if (session.context.onboarding) {
      session.context.onboarding.preferredLanguage = session.language;
      session.context.onboarding.step = 2;
      session.context.onboarding.completedSteps.push('language');
    }

    // Ask for move-in date
    const moveInMessage = getTemplate(ONBOARDING_TEMPLATES.moveInDateRequest, session.language) as string;
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: moveInMessage });

    session.state = 'onboarding_move_in_date';
  }

  private async handleMoveInDate(session: ConversationSession, text: string | null): Promise<void> {
    if (!text) {
      // Ask again
      const message = getTemplate(ONBOARDING_TEMPLATES.moveInDateRequest, session.language) as string;
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: message });
      return;
    }

    // Parse date (supports DD/MM/YYYY, DD-MM-YYYY, etc.)
    const datePattern = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/;
    const match = text.match(datePattern);

    if (!match) {
      const errorMsg = session.language === 'sw'
        ? 'Samahani, sikuelewa tarehe hiyo. Tafadhali tumia muundo DD/MM/YYYY (mfano: 15/03/2026)'
        : 'Sorry, I couldn\'t understand that date. Please use DD/MM/YYYY format (e.g., 15/03/2026)';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }

    const day = match[1] ?? '';
    const month = match[2] ?? '';
    const year = match[3] ?? '';
    const fullYear = year.length === 2 ? '20' + year : year;
    const moveInDate = `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${fullYear}`;

    // Update context
    if (session.context.onboarding) {
      session.context.onboarding.moveInDate = moveInDate;
      session.context.onboarding.step = 3;
      session.context.onboarding.completedSteps.push('move_in_date');
    }

    // Send occupants message
    const occupantsMessage = renderTemplate(
      getTemplate(ONBOARDING_TEMPLATES.occupantsRequest, session.language) as string,
      { moveInDate }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: occupantsMessage });

    // Send buttons
    const buttonTemplate = getTemplate(ONBOARDING_TEMPLATES.occupantsButtons, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (buttonTemplate as { body: string }).body,
      (buttonTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'onboarding_occupants';
  }

  private async handleOccupantsResponse(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const replyId = this.getInteractiveReplyId(message);
    const text = this.extractTextContent(message);

    let occupants = 1;

    if (replyId === 'occupants_1' || text === '1') {
      occupants = 1;
    } else if (replyId === 'occupants_2' || text === '2') {
      occupants = 2;
    // Bug fix A-BUG-DEEP #10: parseInt requires explicit radix.
    } else if (replyId === 'occupants_3_plus' || (text && parseInt(text, 10) >= 3)) {
      occupants = text ? parseInt(text, 10) || 3 : 3;
    } else if (text) {
      const num = parseInt(text, 10);
      if (!isNaN(num) && num > 0) {
        occupants = num;
      }
    }

    // Update context
    if (session.context.onboarding) {
      session.context.onboarding.numberOfOccupants = occupants;
      session.context.onboarding.step = 4;
      session.context.onboarding.completedSteps.push('occupants');
    }

    // Resolve the phone example from the recipient's home country so
    // TZ residents see `+255 ...`, KE residents see `+254 ...`, etc.
    // When `tenant.country` is absent the helper returns a generic
    // `+CC ...` placeholder — never a misleading per-country example.
    // Round-3 audit C4: guard against the unbound-tenant case so we
    // never accidentally query `findById('')` (which some DB layers
    // treat as a wildcard).
    const tenantForExample = isUnboundTenant(session.tenantId)
      ? null
      // nosemgrep: missing-tenant-id-arg reason: `tenantLookup` is the tenants table — the lookup IS the tenant; `session.tenantId` is the key.
      : await this.tenantLookup.findById(session.tenantId);
    const phoneExample = getPhoneExampleForCountry(tenantForExample?.country);

    // Ask for emergency contact
    const emergencyMessage = renderTemplate(
      getTemplate(ONBOARDING_TEMPLATES.emergencyContactRequest, session.language) as string,
      { occupants: occupants.toString(), phoneExample }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: emergencyMessage });

    session.state = 'onboarding_emergency_contact';
  }

  private async handleEmergencyContact(
    session: ConversationSession,
    text: string | null
  ): Promise<void> {
    if (!text) {
      const errorMsg = session.language === 'sw'
        ? 'Tafadhali toa jina na nambari ya simu ya mtu wa kuwasiliana naye wakati wa dharura.'
        : 'Please provide the name and phone number of an emergency contact.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }

    // Round-3 audit H16 fix — the previous `\d{9,}` extracted the
    // FIRST digit run, so input "1234567890 1234567890" silently
    // bound the first sequence as the contact and let HTML / control
    // chars in the residual `name` flow into outbound template
    // substitution. We now:
    //   1. Require a single E.164-shaped phone number per message
    //      (with-or-without `+`, 9-15 digits).
    //   2. Reject multi-phone inputs with a structured retry prompt.
    //   3. Sanitise the residual name to the printable ASCII +
    //      Unicode-letter subset so it cannot inject control chars.
    const phoneMatches = text.match(/\+?\d{9,15}/g) ?? [];
    if (phoneMatches.length === 0) {
      const errorMsg = session.language === 'sw'
        ? 'Sikuweza kupata nambari ya simu. Tafadhali jaribu tena kwa muundo: Jina, Simu'
        : 'I couldn\'t find a phone number. Please try again in format: Name, Phone';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }
    if (phoneMatches.length > 1) {
      const errorMsg = session.language === 'sw'
        ? 'Tafadhali toa nambari moja tu ya simu kwa mtu wa kuwasiliana naye wakati wa dharura.'
        : 'Please provide exactly one phone number for the emergency contact.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }

    const phone: string = phoneMatches[0] ?? '';
    // Strip control chars, NULs, and zero-width chars BEFORE removing
    // the phone segment so the residual name can't smuggle them in.
    // The Unicode-class allow-list at the end is the safety boundary:
    // anything that is not a letter (any script), digit, space, dot,
    // or apostrophe is dropped. That covers ASCII controls, NUL
    // bytes, zero-width spaces, HTML angle brackets, newlines —
    // everything an attacker could use to smuggle markup into
    // outbound WhatsApp template substitutions.
    const rawName = text
      .replace(phone, '')
      // eslint-disable-next-line no-control-regex -- intentional: strip control chars from tenant-supplied name before template substitution.
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\u200b/g, '').replace(/\u200c/g, '').replace(/\u200d/g, '').replace(/\ufeff/g, '')
      .replace(/[,\-]/g, '')
      .trim();
    // Allow letters (any Unicode script), digits, spaces, dot and apostrophe only.
    const name = rawName.replace(/[^\p{L}\d\s.']+/gu, '').trim() || 'Emergency Contact';

    // Update context
    if (session.context.onboarding) {
      session.context.onboarding.emergencyContactName = name;
      session.context.onboarding.emergencyContactPhone = phone;
      session.context.onboarding.step = 5;
      session.context.onboarding.completedSteps.push('emergency_contact');
    }

    // Show confirmation summary
    await this.showOnboardingConfirmation(session);
  }

  private async showOnboardingConfirmation(session: ConversationSession): Promise<void> {
    const ctx = session.context.onboarding;
    if (!ctx) return;

    // Refuse to render the confirmation template if a required field is
    // missing. Previously we substituted `'TBD'` for `moveInDate`, which
    // shipped misleading copy to residents. The state machine should
    // backfill before retrying — surface a TemplateContextIncomplete
    // so the caller can route to the right backfill step instead of
    // silently sending a broken summary.
    const missing: string[] = [];
    if (!ctx.moveInDate) missing.push('moveInDate');
    if (missing.length > 0) {
      logger.warn('Refusing to render onboarding confirmation: missing fields', {
        tenantId: session.tenantId,
        sessionPhoneNumber: session.phoneNumber,
        missing,
      });
      // eslint-disable-next-line no-secrets/no-secrets -- template registry path, not a secret
      throw new TemplateContextIncomplete('ONBOARDING_TEMPLATES.confirmationSummary', missing);
    }

    // Round-3 audit C4: guard against the unbound-tenant case.
    const tenant = isUnboundTenant(session.tenantId)
      ? null
      // nosemgrep: missing-tenant-id-arg reason: `tenantLookup` is the tenants table — the lookup IS the tenant; `session.tenantId` is the key.
      : await this.tenantLookup.findById(session.tenantId);

    // `ctx.moveInDate` is non-null here — the early-return above
    // throws if it is missing. Use the bang operator to satisfy the
    // narrowing strict-null compiler when the typedef carries
    // `moveInDate?: string`.
    const summaryMessage = renderTemplate(
      getTemplate(ONBOARDING_TEMPLATES.confirmationSummary, session.language) as string,
      {
        propertyName: tenant?.propertyName || 'Your Property',
        unitNumber: tenant?.unitNumber || 'Your Unit',
        moveInDate: ctx.moveInDate!,
        occupants: ctx.numberOfOccupants?.toString() || '1',
        emergencyContact: `${ctx.emergencyContactName || ''} (${ctx.emergencyContactPhone || ''})`,
      }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: summaryMessage });

    // Send confirmation buttons
    const buttonTemplate = getTemplate(ONBOARDING_TEMPLATES.confirmationButtons, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (buttonTemplate as { body: string }).body,
      (buttonTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'onboarding_confirmation';
  }

  private async handleOnboardingConfirmation(
    session: ConversationSession,
    message: IncomingMessage,
    tenant: TenantInfo | null
  ): Promise<void> {
    const replyId = this.getInteractiveReplyId(message);
    const text = this.extractTextContent(message)?.toLowerCase();

    if (replyId === 'confirm_no' || text?.includes('no') || text?.includes('hapana') || text?.includes('edit')) {
      // Restart from beginning
      if (session.context.onboarding) {
        session.context.onboarding.step = 1;
        session.context.onboarding.completedSteps = [];
      }

      const restartMsg = session.language === 'sw'
        ? 'Sawa, tuanze tena. Unapendelea lugha gani?'
        : 'Okay, let\'s start over. What language do you prefer?';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: restartMsg });
      
      const langTemplate = getTemplate(ONBOARDING_TEMPLATES.languageSelection, session.language);
      await this.whatsappClient.sendButtons(
        session.phoneNumber,
        (langTemplate as { body: string }).body,
        (langTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
      );

      session.state = 'onboarding_language';
      return;
    }

    // Confirmed - complete onboarding
    if (session.context.onboarding) {
      session.context.onboarding.step = 6;
      session.context.onboarding.completedSteps.push('confirmation');
    }

    // Send completion message
    const completeMessage = renderTemplate(
      getTemplate(ONBOARDING_TEMPLATES.onboardingComplete, session.language) as string,
      { tenantName: tenant?.name || 'valued tenant' }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: completeMessage });

    // Update tenant onboarding status
    if (tenant) {
      await this.tenantLookup.updateOnboardingStatus(tenant.tenantId, 'completed');
    }

    session.state = 'onboarding_complete';

    logger.info('Onboarding completed', { 
      tenantId: tenant?.tenantId,
      phoneNumber: session.phoneNumber 
    });
  }

  // ============================================================================
  // Other Handlers
  // ============================================================================

  private async handlePaymentInquiry(
    session: ConversationSession,
    tenant: TenantInfo | null
  ): Promise<void> {
    const msg = session.language === 'sw'
      ? `💰 *Maelezo ya Malipo*\n\nHabari ${tenant?.name || ''}!\n\nKwa maelezo ya kodi na malipo, jibu "salio" kupata salio lako la sasa au "lipa" kupata maelekezo ya malipo.`
      : `💰 *Payment Information*\n\nHi ${tenant?.name || ''}!\n\nFor rent and payment details, reply "balance" to get your current balance or "pay" for payment instructions.`;

    await this.whatsappClient.sendText({ to: session.phoneNumber, text: msg });
    session.state = 'awaiting_response';
  }

  private async handleGenericResponse(
    session: ConversationSession,
    message: IncomingMessage,
    tenant: TenantInfo | null,
    text: string | null
  ): Promise<void> {
    // Route based on text content
    if (text) {
      const lowerText = text.toLowerCase();

      if (lowerText.includes('maintenance') || lowerText.includes('matengenezo') ||
          lowerText.includes('repair') || lowerText.includes('broken') || lowerText.includes('leak')) {
        session.state = 'maintenance_intake';
        return;
      }

      if (lowerText.includes('thank') || lowerText.includes('asante')) {
        const response = session.language === 'sw' 
          ? 'Karibu sana! Niko hapa ukihitaji msaada wowote. 🏠'
          : 'You\'re welcome! I\'m here if you need any help. 🏠';
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: response });
        session.state = 'idle';
        return;
      }
    }

    // Default response
    const template = getTemplate(GENERAL_TEMPLATES.unknownCommand, session.language) as string;
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: template });
  }

  private async handleUnknownState(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    logger.warn('Unknown conversation state', { state: session.state });
    
    const template = getTemplate(GENERAL_TEMPLATES.sessionExpired, session.language) as string;
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: template });
    
    session.state = 'idle';
    session.context = {};
  }

  // ============================================================================
  // Emergency Detection
  // ============================================================================

  private containsEmergencyKeyword(text: string, language: SupportedLanguage): boolean {
    const config = this.whatsappClient.getConfig();
    const keywords = config.emergencyKeywords[language] || [];
    const lowerText = text.toLowerCase();
    
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Send a proactive message to a tenant
   */
  async sendProactiveMessage(
    phoneNumber: string,
    message: string,
    language: SupportedLanguage = 'en'
  ): Promise<void> {
    await this.whatsappClient.sendText({ to: phoneNumber, text: message });
    logger.info('Sent proactive message', { to: phoneNumber });
  }

  /**
   * Initiate onboarding for a new tenant
   */
  async initiateOnboarding(tenant: TenantInfo): Promise<void> {
    let session = await this.sessionStore.get(tenant.phoneNumber);
    
    if (!session) {
      session = await this.createNewSession(tenant.phoneNumber, tenant);
    }

    await this.startOnboarding(session, tenant);
    await this.sessionStore.set(session);
  }

  /**
   * Get current session for a phone number
   */
  async getSession(phoneNumber: string): Promise<ConversationSession | null> {
    return this.sessionStore.get(phoneNumber);
  }

  /**
   * Clear session for a phone number
   */
  async clearSession(phoneNumber: string): Promise<void> {
    await this.sessionStore.delete(phoneNumber);
    logger.info('Session cleared', { phoneNumber });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createConversationOrchestrator(options: {
  whatsappClient: MetaWhatsAppClient;
  sessionStore?: SessionStore;
  tenantLookup: TenantLookup;
  sessionTimeoutMinutes?: number;
}): ConversationOrchestrator {
  return new ConversationOrchestrator({
    whatsappClient: options.whatsappClient,
    sessionStore: options.sessionStore || new InMemorySessionStore(),
    tenantLookup: options.tenantLookup,
    sessionTimeoutMinutes: options.sessionTimeoutMinutes,
  });
}
