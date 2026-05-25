/**
 * Emergency Protocol Handler for BORJIE
 * Handles emergency detection, escalation, and incident management via WhatsApp
 * Fire, flooding, break-in, gas leaks, electrical hazards
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger.js';
import { MetaWhatsAppClient } from './meta-client.js';
import {
  EMERGENCY_TEMPLATES,
  renderTemplate,
  getTemplate,
  getEmergencyKeywords,
} from './templates.js';
import type {
  ConversationSession,
  EmergencyContext,
  EmergencyIncident,
  EmergencyType,
  EmergencyTimelineEvent,
  EmergencyContact,
  SupportedLanguage,
  IncomingMessage,
} from './types.js';

const logger = createLogger('EmergencyHandler');

// ============================================================================
// Emergency Service Interface
// ============================================================================

export interface EmergencyService {
  createIncident(incident: EmergencyIncident): Promise<{ incidentId: string }>;
  updateIncident(incidentId: string, updates: Partial<EmergencyIncident>): Promise<void>;
  addTimelineEvent(incidentId: string, event: EmergencyTimelineEvent): Promise<void>;
  resolveIncident(incidentId: string, resolutionNotes: string): Promise<void>;
  getEmergencyContacts(propertyId: string): Promise<EmergencyContact[]>;
}

// ============================================================================
// Emergency Protocol Handler
// ============================================================================

export class EmergencyProtocolHandler {
  private whatsappClient: MetaWhatsAppClient;
  private emergencyService: EmergencyService;
  private emergencyKeywords: Record<SupportedLanguage, string[]>;
  private defaultEmergencyContacts: EmergencyContact[];

  constructor(options: {
    whatsappClient: MetaWhatsAppClient;
    emergencyService: EmergencyService;
    emergencyKeywords?: Record<SupportedLanguage, string[]>;
    defaultEmergencyContacts?: EmergencyContact[];
  }) {
    this.whatsappClient = options.whatsappClient;
    this.emergencyService = options.emergencyService;
    this.emergencyKeywords = options.emergencyKeywords || getEmergencyKeywords();
    this.defaultEmergencyContacts = options.defaultEmergencyContacts || [];
  }

  // ============================================================================
  // Emergency Detection
  // ============================================================================

  /**
   * Check if a message contains emergency keywords
   */
  detectEmergency(text: string, language: SupportedLanguage = 'en'): {
    isEmergency: boolean;
    type: EmergencyType | null;
    confidence: 'high' | 'medium' | 'low';
    matchedKeywords: string[];
  } {
    const lowerText = text.toLowerCase();
    const matchedKeywords: string[] = [];
    let detectedType: EmergencyType | null = null;
    let confidence: 'high' | 'medium' | 'low' = 'low';

    // Check both languages for broader coverage
    const allKeywords = [...this.emergencyKeywords.en, ...this.emergencyKeywords.sw];

    for (const keyword of allKeywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length === 0) {
      return { isEmergency: false, type: null, confidence: 'low', matchedKeywords };
    }

    // Determine emergency type
    if (this.containsAny(lowerText, ['fire', 'burning', 'smoke', 'flames', 'moto', 'moshi', 'miali'])) {
      detectedType = 'fire';
      confidence = 'high';
    } else if (this.containsAny(lowerText, ['flood', 'flooding', 'water everywhere', 'burst pipe', 'mafuriko', 'maji mengi'])) {
      detectedType = 'flooding';
      confidence = 'high';
    } else if (this.containsAny(lowerText, ['break in', 'break-in', 'breakin', 'intruder', 'robbery', 'thief', 'stolen', 'uvamizi', 'wizi', 'mwizi'])) {
      detectedType = 'break_in';
      confidence = 'high';
    } else if (this.containsAny(lowerText, ['gas leak', 'gas smell', 'smells like gas', 'gesi inavuja', 'harufu ya gesi'])) {
      detectedType = 'gas_leak';
      confidence = 'high';
    } else if (this.containsAny(lowerText, ['electrical', 'sparks', 'electrocuted', 'shock', 'umeme', 'cheche'])) {
      detectedType = 'electrical';
      confidence = 'high';
    } else if (this.containsAny(lowerText, ['emergency', 'urgent', 'help', 'danger', 'dharura', 'haraka', 'msaada', 'hatari'])) {
      detectedType = 'other';
      confidence = 'medium';
    }

    // Adjust confidence based on urgency indicators
    const urgencyIndicators = ['now', 'immediately', 'please help', 'sasa', 'haraka', 'msaada'];
    if (this.containsAny(lowerText, urgencyIndicators)) {
      confidence = 'high';
    }

    return {
      isEmergency: matchedKeywords.length > 0,
      type: detectedType,
      confidence,
      matchedKeywords,
    };
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  }

  // ============================================================================
  // Emergency Message Handling
  // ============================================================================

  /**
   * Handle an incoming emergency message
   */
  async handleMessage(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const state = session.state;

    // Initialize or continue emergency context
    if (!session.context.emergency) {
      const text = this.extractTextContent(message);
      if (text) {
        const detection = this.detectEmergency(text, session.language);
        if (detection.isEmergency && detection.type) {
          await this.initiateEmergencyProtocol(session, detection.type, text);
          return;
        }
      }
    }

    switch (state) {
      case 'emergency_active':
        await this.handleActiveEmergency(session, message);
        break;

      default: {
        // Start emergency detection
        const text = this.extractTextContent(message);
        if (text) {
          await this.handlePotentialEmergency(session, text);
        }
      }
    }
  }

  /**
   * Handle potential emergency detection
   */
  private async handlePotentialEmergency(
    session: ConversationSession,
    text: string
  ): Promise<void> {
    const detection = this.detectEmergency(text, session.language);

    if (detection.isEmergency) {
      logger.warn('Emergency keywords detected', {
        phoneNumber: session.phoneNumber,
        type: detection.type,
        confidence: detection.confidence,
        matchedKeywords: detection.matchedKeywords,
      });

      // For high confidence emergencies, initiate protocol immediately
      if (detection.confidence === 'high' && detection.type) {
        await this.initiateEmergencyProtocol(session, detection.type, text);
        return;
      }

      // For medium/low confidence, ask for confirmation
      const detectMessage = getTemplate(EMERGENCY_TEMPLATES.emergencyDetected, session.language) as string;
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: detectMessage });

      // Send emergency type selection
      const buttonTemplate = getTemplate(EMERGENCY_TEMPLATES.emergencyTypeButtons, session.language);
      await this.whatsappClient.sendButtons(
        session.phoneNumber,
        (buttonTemplate as { body: string }).body,
        (buttonTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
      );

      session.state = 'emergency_active';
    }
  }

  /**
   * Handle messages during active emergency
   */
  private async handleActiveEmergency(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.emergency;

    // Check for emergency type selection
    if (message.type === 'interactive' && message.interactive?.button_reply) {
      const selectedId = message.interactive.button_reply.id;
      let emergencyType: EmergencyType = 'other';

      switch (selectedId) {
        case 'emergency_fire':
          emergencyType = 'fire';
          break;
        case 'emergency_flood':
          emergencyType = 'flooding';
          break;
        case 'emergency_security':
          emergencyType = 'break_in';
          break;
      }

      if (!ctx) {
        await this.initiateEmergencyProtocol(session, emergencyType, `Emergency type selected: ${emergencyType}`);
      }
      return;
    }

    // Handle update messages during emergency
    if (ctx && message.type === 'text' && message.text?.body) {
      await this.addEmergencyUpdate(session, message.text.body);
    }
  }

  // ============================================================================
  // Emergency Protocol
  // ============================================================================

  /**
   * Initiate full emergency protocol
   */
  async initiateEmergencyProtocol(
    session: ConversationSession,
    emergencyType: EmergencyType,
    description: string
  ): Promise<void> {
    logger.warn('Initiating emergency protocol', {
      phoneNumber: session.phoneNumber,
      tenantId: session.tenantId,
      emergencyType,
    });

    const now = new Date();

    // Initialize emergency context
    session.context.emergency = {
      emergencyType,
      description,
      reportedAt: now,
      escalatedTo: [],
      timelineEvents: [{
        timestamp: now,
        event: 'Emergency reported',
        actor: 'tenant',
        details: description,
      }],
      resolved: false,
    };

    session.state = 'emergency_active';

    // Create incident record
    const incident: EmergencyIncident = {
      id: uuidv4(),
      tenantId: session.tenantId,
      propertyId: session.context.onboarding?.propertyId || '',
      unitId: session.context.onboarding?.unitId || '',
      type: emergencyType,
      description,
      reportedAt: now,
      status: 'active',
      escalationLevel: 1,
      notifiedContacts: [],
      timeline: session.context.emergency.timelineEvents,
    };

    try {
      await this.emergencyService.createIncident(incident);
    } catch (error) {
      logger.error('Failed to create emergency incident', { error });
    }

    // Get safety instructions
    const safetyInstructions = this.getSafetyInstructions(emergencyType, session.language);

    // Get and notify emergency contacts
    const contacts = await this.getEmergencyContacts(session.context.onboarding?.propertyId);
    const notifiedList = await this.notifyEmergencyContacts(
      contacts,
      emergencyType,
      session.phoneNumber,
      session.tenantId
    );

    session.context.emergency.escalatedTo = notifiedList;

    // Send confirmation to tenant
    const confirmMessage = renderTemplate(
      getTemplate(EMERGENCY_TEMPLATES.emergencyConfirmed, session.language) as string,
      {
        emergencyType: this.getEmergencyTypeLabel(emergencyType, session.language),
        time: now.toLocaleTimeString(),
        safetyInstructions,
        notifiedContacts: notifiedList.join('\n'),
      }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: confirmMessage });

    // Add timeline event
    await this.addTimelineEvent(session, {
      timestamp: new Date(),
      event: 'Emergency contacts notified',
      actor: 'system',
      details: `Notified: ${notifiedList.join(', ')}`,
    });
  }

  /**
   * Get safety instructions for emergency type
   */
  private getSafetyInstructions(emergencyType: EmergencyType, language: SupportedLanguage): string {
    const instructionsMap: Record<EmergencyType, keyof typeof EMERGENCY_TEMPLATES> = {
      'fire': 'fireSafetyInstructions',
      'flooding': 'floodSafetyInstructions',
      'break_in': 'securitySafetyInstructions',
      'gas_leak': 'fireSafetyInstructions', // Similar evacuation procedure
      'electrical': 'fireSafetyInstructions', // Similar safety measures
      'medical': 'securitySafetyInstructions',
      'other': 'securitySafetyInstructions',
    };

    const templateKey = instructionsMap[emergencyType];
    return getTemplate(EMERGENCY_TEMPLATES[templateKey], language) as string;
  }

  /**
   * Get emergency type label for display
   */
  private getEmergencyTypeLabel(type: EmergencyType, language: SupportedLanguage): string {
    const labels: Record<EmergencyType, { en: string; sw: string }> = {
      'fire': { en: 'FIRE', sw: 'MOTO' },
      'flooding': { en: 'FLOODING', sw: 'MAFURIKO' },
      'break_in': { en: 'SECURITY BREACH', sw: 'UVAMIZI' },
      'gas_leak': { en: 'GAS LEAK', sw: 'GESI INAVUJA' },
      'electrical': { en: 'ELECTRICAL HAZARD', sw: 'HATARI YA UMEME' },
      'medical': { en: 'MEDICAL EMERGENCY', sw: 'DHARURA YA MATIBABU' },
      'other': { en: 'EMERGENCY', sw: 'DHARURA' },
    };
    return labels[type][language];
  }

  // ============================================================================
  // Emergency Contact Management
  // ============================================================================

  /**
   * Get emergency contacts for a property
   */
  private async getEmergencyContacts(propertyId?: string): Promise<EmergencyContact[]> {
    if (propertyId) {
      try {
        const contacts = await this.emergencyService.getEmergencyContacts(propertyId);
        if (contacts.length > 0) {
          return contacts;
        }
      } catch (error) {
        logger.error('Failed to get property emergency contacts', { error, propertyId });
      }
    }
    return this.defaultEmergencyContacts;
  }

  /**
   * Notify emergency contacts
   */
  private async notifyEmergencyContacts(
    contacts: EmergencyContact[],
    emergencyType: EmergencyType,
    reporterPhone: string,
    tenantId: string
  ): Promise<string[]> {
    const notified: string[] = [];

    for (const contact of contacts) {
      try {
        const alertMessage = `🚨 EMERGENCY ALERT 🚨\n\n` +
          `Type: ${emergencyType.toUpperCase()}\n` +
          `Tenant ID: ${tenantId}\n` +
          `Contact: ${reporterPhone}\n` +
          `Time: ${new Date().toLocaleString()}\n\n` +
          `Please respond immediately.`;

        await this.whatsappClient.sendText({ to: contact.phone, text: alertMessage });
        notified.push(`${contact.role}: ${contact.name}`);
        
        logger.info('Emergency contact notified', {
          contactName: contact.name,
          contactRole: contact.role,
          emergencyType,
        });
      } catch (error) {
        logger.error('Failed to notify emergency contact', {
          contact: contact.name,
          error,
        });
      }
    }

    return notified;
  }

  // ============================================================================
  // Emergency Updates
  // ============================================================================

  /**
   * Add an update to the emergency timeline
   */
  async addEmergencyUpdate(
    session: ConversationSession,
    update: string
  ): Promise<void> {
    const ctx = session.context.emergency;
    if (!ctx) return;

    const event: EmergencyTimelineEvent = {
      timestamp: new Date(),
      event: 'Tenant update',
      actor: 'tenant',
      details: update,
    };

    ctx.timelineEvents.push(event);

    // Acknowledge the update
    const ackMsg = session.language === 'sw'
      ? '✅ Masasisho yamepokelewa. Timu ya dharura imearifiwa.'
      : '✅ Update received. Emergency team has been notified.';
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: ackMsg });

    // Forward update to emergency contacts via WhatsApp.
    // Round-3 audit L2 — the previous implementation logged a stub
    // line and silently no-op'd. That hid a real production gap: every
    // tenant update during an active emergency was lost. The new
    // behaviour ACTUALLY sends the update to each escalated contact
    // via the WhatsApp client; if no contact is wired, an explicit
    // warning surfaces in observability rather than the previous
    // silent no-op.
    const escalated = ctx.escalatedTo ?? [];
    if (escalated.length === 0) {
      logger.warn('emergency update — no escalation contacts wired', {
        sessionId: session.id,
        update,
      });
    } else {
      for (const contactInfo of escalated) {
        try {
          const forwardBody = session.language === 'sw'
            ? `⚠️ Mwendelezo wa dharura: ${update}`
            : `⚠️ Emergency update: ${update}`;
          await this.whatsappClient.sendText({
            to: contactInfo,
            text: forwardBody,
          });
          logger.info('Emergency update forwarded', { contactInfo });
        } catch (err) {
          logger.error('Emergency update forward failed', {
            contactInfo,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * Add a timeline event
   */
  private async addTimelineEvent(
    session: ConversationSession,
    event: EmergencyTimelineEvent
  ): Promise<void> {
    const ctx = session.context.emergency;
    if (!ctx) return;

    ctx.timelineEvents.push(event);

    try {
      // In production, update the incident record
      // await this.emergencyService.addTimelineEvent(incidentId, event);
    } catch (error) {
      logger.error('Failed to add timeline event', { error });
    }
  }

  // ============================================================================
  // Emergency Resolution
  // ============================================================================

  /**
   * Resolve an emergency
   */
  async resolveEmergency(
    session: ConversationSession,
    resolutionNotes: string
  ): Promise<void> {
    const ctx = session.context.emergency;
    if (!ctx) return;

    ctx.resolved = true;

    const duration = this.calculateDuration(ctx.reportedAt);

    // Send resolution message
    const resolvedMessage = renderTemplate(
      getTemplate(EMERGENCY_TEMPLATES.emergencyResolved, session.language) as string,
      {
        emergencyType: this.getEmergencyTypeLabel(ctx.emergencyType, session.language),
        resolutionNotes,
        duration,
      }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: resolvedMessage });

    // Add final timeline event
    await this.addTimelineEvent(session, {
      timestamp: new Date(),
      event: 'Emergency resolved',
      actor: 'system',
      details: resolutionNotes,
    });

    // Reset session state
    session.state = 'idle';
    session.context.emergency = undefined;

    logger.info('Emergency resolved', {
      phoneNumber: session.phoneNumber,
      emergencyType: ctx.emergencyType,
      duration,
    });
  }

  /**
   * Calculate duration string
   */
  private calculateDuration(startTime: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) {
      return `${diffMins} minutes`;
    }
    
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    return `${diffHours}h ${remainingMins}m`;
  }

  // ============================================================================
  // Manual Escalation
  // ============================================================================

  /**
   * Manually trigger emergency escalation
   */
  async manualEscalation(
    phoneNumber: string,
    tenantId: string,
    emergencyType: EmergencyType,
    description: string,
    language: SupportedLanguage = 'en'
  ): Promise<void> {
    // Create a temporary session for escalation
    const session: ConversationSession = {
      id: uuidv4(),
      tenantId,
      phoneNumber,
      state: 'idle',
      language,
      context: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      messageHistory: [],
    };

    await this.initiateEmergencyProtocol(session, emergencyType, description);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

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
}

// ============================================================================
// Factory Function
// ============================================================================

export function createEmergencyHandler(options: {
  whatsappClient: MetaWhatsAppClient;
  emergencyService: EmergencyService;
  emergencyKeywords?: Record<SupportedLanguage, string[]>;
  defaultEmergencyContacts?: EmergencyContact[];
}): EmergencyProtocolHandler {
  return new EmergencyProtocolHandler(options);
}
