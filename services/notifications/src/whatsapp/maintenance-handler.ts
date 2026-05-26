/**
 * Maintenance Request Handler for BORJIE
 * Handles Module F - Maintenance & Asset Tracking workflows via WhatsApp
 * "My sink is leaking" → extract location, severity, photo → work order
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger.js';
import { MetaWhatsAppClient } from './meta-client.js';
import {
  MAINTENANCE_TEMPLATES,
  renderTemplate,
  getTemplate,
  detectLanguage,
} from './templates.js';
import type {
  ConversationSession,
  MaintenanceContext,
  MaintenanceSeverity,
  SupportedLanguage,
  IncomingMessage,
  WorkOrderFromChat,
} from './types.js';

const logger = createLogger('MaintenanceHandler');

// ============================================================================
// Issue Type Mapping
// ============================================================================

const ISSUE_TYPE_MAP: Record<string, { en: string; sw: string; category: string }> = {
  issue_plumbing_leak: { en: 'Leaking Pipe/Tap', sw: 'Bomba/Mfereji Unavuja', category: 'plumbing' },
  issue_plumbing_blocked: { en: 'Blocked Drain/Toilet', sw: 'Mfereji Umeziba', category: 'plumbing' },
  issue_plumbing_nowater: { en: 'No Water Supply', sw: 'Hakuna Maji', category: 'plumbing' },
  issue_electrical_nopower: { en: 'No Power', sw: 'Hakuna Stima', category: 'electrical' },
  issue_electrical_socket: { en: 'Faulty Socket/Switch', sw: 'Soketi Mbaya', category: 'electrical' },
  issue_electrical_sparks: { en: 'Electrical Sparks/Hazard', sw: 'Cheche za Umeme', category: 'electrical' },
  issue_door_lock: { en: 'Door/Lock Issue', sw: 'Tatizo la Mlango/Kufuli', category: 'structural' },
  issue_window: { en: 'Window Problem', sw: 'Tatizo la Dirisha', category: 'structural' },
  issue_other: { en: 'Other Issue', sw: 'Tatizo Lingine', category: 'other' },
};

const SEVERITY_MAP: Record<string, MaintenanceSeverity> = {
  severity_low: 'low',
  severity_medium: 'medium',
  severity_high: 'high',
};

// ============================================================================
// Work Order Service Interface
// ============================================================================

export interface WorkOrderService {
  create(workOrder: WorkOrderFromChat): Promise<{ ticketId: string }>;
  update(ticketId: string, updates: Partial<WorkOrderFromChat>): Promise<void>;
  addPhoto(ticketId: string, photoUrl: string): Promise<void>;
  addVoiceNote(ticketId: string, voiceUrl: string, transcription?: string): Promise<void>;
}

// ============================================================================
// Voice Transcription Service Interface
// ============================================================================

export interface TranscriptionService {
  transcribe(audioBuffer: Buffer, language: SupportedLanguage): Promise<string>;
}

// ============================================================================
// Maintenance Request Handler
// ============================================================================

export class MaintenanceRequestHandler {
  private whatsappClient: MetaWhatsAppClient;
  private workOrderService: WorkOrderService;
  private transcriptionService: TranscriptionService | undefined;

  constructor(options: {
    whatsappClient: MetaWhatsAppClient;
    workOrderService: WorkOrderService;
    transcriptionService?: TranscriptionService;
  }) {
    this.whatsappClient = options.whatsappClient;
    this.workOrderService = options.workOrderService;
    this.transcriptionService = options.transcriptionService;
  }

  // ============================================================================
  // Main Handler
  // ============================================================================

  /**
   * Handle maintenance-related messages
   */
  async handleMessage(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const state = session.state;

    // Initialize maintenance context if needed
    if (!session.context.maintenance) {
      session.context.maintenance = {
        step: 0,
        photoUrls: [],
      };
    }

    switch (state) {
      case 'maintenance_intake':
        await this.handleIntake(session, message);
        break;

      case 'maintenance_location':
        await this.handleLocation(session, message);
        break;

      case 'maintenance_severity':
        await this.handleSeverity(session, message);
        break;

      case 'maintenance_photo':
        await this.handlePhotoUpload(session, message);
        break;

      case 'maintenance_confirmation':
        await this.handleConfirmation(session, message);
        break;

      default:
        // Start maintenance flow
        await this.startMaintenanceFlow(session);
    }
  }

  // ============================================================================
  // Flow Steps
  // ============================================================================

  /**
   * Start the maintenance request flow
   */
  async startMaintenanceFlow(session: ConversationSession): Promise<void> {
    logger.info('Starting maintenance flow', { phoneNumber: session.phoneNumber });

    // Initialize context
    session.context.maintenance = {
      step: 1,
      photoUrls: [],
    };

    // Send intake prompt
    const intakeMessage = getTemplate(MAINTENANCE_TEMPLATES.intakePrompt, session.language) as string;
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: intakeMessage });

    // Send issue type list
    const listTemplate = getTemplate(MAINTENANCE_TEMPLATES.issueTypeList, session.language);
    const headerText = (listTemplate as { header?: string }).header;
    await this.whatsappClient.sendList(
      session.phoneNumber,
      (listTemplate as { body: string }).body,
      (listTemplate as { sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }).sections,
      headerText !== undefined
        ? { header: { type: 'text', text: headerText } }
        : {}
    );

    session.state = 'maintenance_intake';
  }

  /**
   * Handle issue type selection or free-form description
   */
  private async handleIntake(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.maintenance!;
    let issueType: string | undefined;
    let issueDescription: string | undefined;

    // Check for list selection
    if (message.type === 'interactive' && message.interactive?.list_reply) {
      const selectedId = message.interactive.list_reply.id;
      const issueInfo = ISSUE_TYPE_MAP[selectedId];
      
      if (issueInfo) {
        issueType = issueInfo[session.language];
        ctx.issueType = issueType;

        // Check for emergency issue (electrical sparks)
        if (selectedId === 'issue_electrical_sparks') {
          await this.handleEmergencyIssue(session, 'electrical');
          return;
        }
      }
    } else if (message.type === 'text' && message.text?.body) {
      // Free-form text - extract issue description
      issueDescription = message.text.body;
      ctx.issueDescription = issueDescription;

      // Try to auto-detect issue type from text
      const detectedType = this.detectIssueType(issueDescription, session.language);
      if (detectedType) {
        issueType = detectedType;
        ctx.issueType = issueType;
      }
    } else if (message.type === 'audio') {
      // Voice note - transcribe it
      await this.handleVoiceNote(session, message);
      return;
    }

    if (!issueType && !issueDescription) {
      // Ask again
      const errorMsg = session.language === 'sw'
        ? 'Tafadhali chagua aina ya tatizo kutoka kwenye orodha au eleza tatizo lako.'
        : 'Please select an issue type from the list or describe your problem.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }

    ctx.step = 2;

    // Ask for location
    const locationMessage = renderTemplate(
      getTemplate(MAINTENANCE_TEMPLATES.locationRequest, session.language) as string,
      { issueType: issueType || issueDescription || 'Issue' }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: locationMessage });

    session.state = 'maintenance_location';
  }

  /**
   * Handle location input
   */
  private async handleLocation(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.maintenance!;
    let location: string | undefined;

    if (message.type === 'text' && message.text?.body) {
      location = message.text.body;
    } else if (message.type === 'location' && message.location) {
      location = message.location.name || message.location.address || 
        `${message.location.latitude}, ${message.location.longitude}`;
    }

    if (!location) {
      const errorMsg = session.language === 'sw'
        ? 'Tafadhali eleza mahali tatizo lilipo (mfano: Jikoni, chini ya sinki)'
        : 'Please describe where the problem is located (e.g., Kitchen, under the sink)';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      return;
    }

    ctx.location = location;
    ctx.step = 3;

    // Ask for severity
    const severityMessage = renderTemplate(
      getTemplate(MAINTENANCE_TEMPLATES.severityRequest, session.language) as string,
      { location }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: severityMessage });

    // Send severity buttons
    const buttonTemplate = getTemplate(MAINTENANCE_TEMPLATES.severityButtons, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (buttonTemplate as { body: string }).body,
      (buttonTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'maintenance_severity';
  }

  /**
   * Handle severity selection
   */
  private async handleSeverity(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.maintenance!;
    let severity: MaintenanceSeverity = 'medium';

    if (message.type === 'interactive' && message.interactive?.button_reply) {
      const selectedId = message.interactive.button_reply.id;
      severity = SEVERITY_MAP[selectedId] || 'medium';
    } else if (message.type === 'text' && message.text?.body) {
      const text = message.text.body.toLowerCase();
      if (text.includes('low') || text.includes('wait') || text.includes('can wait') ||
          text.includes('chini') || text.includes('kungoja')) {
        severity = 'low';
      } else if (text.includes('urgent') || text.includes('emergency') || text.includes('now') ||
                 text.includes('haraka') || text.includes('dharura') || text.includes('sasa')) {
        severity = 'high';
      }
    }

    ctx.severity = severity;
    ctx.step = 4;

    // Ask for photo
    const severityLabel = this.getSeverityLabel(severity, session.language);
    const photoMessage = renderTemplate(
      getTemplate(MAINTENANCE_TEMPLATES.photoRequest, session.language) as string,
      { severity: severityLabel }
    );
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: photoMessage });

    // Send skip option
    const skipTemplate = getTemplate(MAINTENANCE_TEMPLATES.skipPhotoOption, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (skipTemplate as { body: string }).body,
      (skipTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'maintenance_photo';
  }

  /**
   * Handle photo/media upload
   */
  private async handlePhotoUpload(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.maintenance!;

    // Check for skip
    if (message.type === 'interactive' && message.interactive?.button_reply?.id === 'photo_skip') {
      await this.submitMaintenanceRequest(session);
      return;
    }

    if (message.type === 'text' && message.text?.body.toLowerCase().includes('skip')) {
      await this.submitMaintenanceRequest(session);
      return;
    }

    // Handle image upload
    if (message.type === 'image' && message.image) {
      try {
        const mediaInfo = await this.whatsappClient.getMediaUrl(message.image.id);
        ctx.photoUrls = ctx.photoUrls || [];
        ctx.photoUrls.push(mediaInfo.url);

        const confirmMsg = session.language === 'sw'
          ? '📸 Picha imepokelewa! Unaweza kutuma zaidi au jibu "tayari" kuendelea.'
          : '📸 Photo received! You can send more or reply "done" to continue.';
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: confirmMsg });

        // Give option to add more or continue
        await this.whatsappClient.sendButtons(
          session.phoneNumber,
          session.language === 'sw' ? 'Hatua inayofuata?' : 'Next step?',
          [
            { id: 'photo_more', title: session.language === 'sw' ? '📸 Ongeza Picha' : '📸 Add More' },
            { id: 'photo_done', title: session.language === 'sw' ? '✅ Endelea' : '✅ Continue' },
          ]
        );
      } catch (error) {
        logger.error('Failed to get media URL', { error });
        const errorMsg = session.language === 'sw'
          ? 'Samahani, sikuweza kupokea picha. Tafadhali jaribu tena.'
          : 'Sorry, I couldn\'t receive the photo. Please try again.';
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
      }
      return;
    }

    // Handle video upload
    if (message.type === 'video' && message.video) {
      try {
        const mediaInfo = await this.whatsappClient.getMediaUrl(message.video.id);
        ctx.photoUrls = ctx.photoUrls || [];
        ctx.photoUrls.push(mediaInfo.url);

        const confirmMsg = session.language === 'sw'
          ? '🎥 Video imepokelewa! Jibu "tayari" kuendelea.'
          : '🎥 Video received! Reply "done" to continue.';
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: confirmMsg });
        
        await this.whatsappClient.sendButtons(
          session.phoneNumber,
          session.language === 'sw' ? 'Endelea?' : 'Continue?',
          [
            { id: 'photo_done', title: session.language === 'sw' ? '✅ Endelea' : '✅ Continue' },
          ]
        );
      } catch (error) {
        logger.error('Failed to get video URL', { error });
      }
      return;
    }

    // Handle voice note
    if (message.type === 'audio' && message.audio) {
      await this.handleVoiceNote(session, message);
      return;
    }

    // Check for "done" button
    if (message.type === 'interactive' && message.interactive?.button_reply?.id === 'photo_done') {
      await this.submitMaintenanceRequest(session);
      return;
    }

    // Text response - might be additional description
    if (message.type === 'text' && message.text?.body) {
      const text = message.text.body.toLowerCase();
      if (text === 'done' || text === 'tayari' || text === 'continue' || text === 'endelea') {
        await this.submitMaintenanceRequest(session);
        return;
      }

      // Add as additional description
      ctx.issueDescription = (ctx.issueDescription || '') + '\n' + message.text.body;
      
      const confirmMsg = session.language === 'sw'
        ? 'Maelezo yameongezwa. Tuma picha au jibu "tayari" kuendelea.'
        : 'Description added. Send a photo or reply "done" to continue.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: confirmMsg });
    }
  }

  /**
   * Handle confirmation after submission
   */
  private async handleConfirmation(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    // Reset to idle state
    session.state = 'idle';
    delete session.context.maintenance;

    const thankYouMsg = session.language === 'sw'
      ? 'Asante! Kama unahitaji msaada mwingine, niambie tu.'
      : 'Thank you! If you need anything else, just let me know.';
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: thankYouMsg });
  }

  // ============================================================================
  // Voice Note Handling
  // ============================================================================

  /**
   * Handle voice note message
   */
  private async handleVoiceNote(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.maintenance!;

    if (!message.audio) return;

    try {
      const mediaInfo = await this.whatsappClient.getMediaUrl(message.audio.id);
      ctx.voiceNoteUrl = mediaInfo.url;

      // Acknowledge receipt
      const ackMsg = session.language === 'sw'
        ? '🎤 Ujumbe wa sauti umepokelewa...'
        : '🎤 Voice note received...';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: ackMsg });

      // Transcribe if service available
      if (this.transcriptionService) {
        const audioBuffer = await this.whatsappClient.downloadMedia(message.audio.id);
        const transcription = await this.transcriptionService.transcribe(audioBuffer, session.language);
        
        ctx.transcribedText = transcription;
        ctx.issueDescription = (ctx.issueDescription || '') + '\n[Voice]: ' + transcription;

        const transcribedMsg = session.language === 'sw'
          ? `📝 Nimelisikia: "${transcription}"\n\nJe, hii ni sahihi?`
          : `📝 I heard: "${transcription}"\n\nIs this correct?`;
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: transcribedMsg });
      }

      // Continue to next step based on current state
      if (session.state === 'maintenance_intake' && !ctx.issueType) {
        // Try to detect issue type from transcription
        if (ctx.transcribedText) {
          const detectedType = this.detectIssueType(ctx.transcribedText, session.language);
          if (detectedType) {
            ctx.issueType = detectedType;
          }
        }

        // Ask for location
        const locationMessage = renderTemplate(
          getTemplate(MAINTENANCE_TEMPLATES.locationRequest, session.language) as string,
          { issueType: ctx.issueType || 'Issue reported via voice' }
        );
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: locationMessage });
        session.state = 'maintenance_location';
      }
    } catch (error) {
      logger.error('Failed to process voice note', { error });
      const errorMsg = session.language === 'sw'
        ? 'Samahani, sikuweza kuchakata ujumbe wa sauti. Tafadhali andika tatizo lako.'
        : 'Sorry, I couldn\'t process the voice note. Please type your issue instead.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
    }
  }

  // ============================================================================
  // Work Order Submission
  // ============================================================================

  /**
   * Submit the maintenance request and create a work order
   */
  private async submitMaintenanceRequest(session: ConversationSession): Promise<void> {
    const ctx = session.context.maintenance!;

    logger.info('Submitting maintenance request', {
      phoneNumber: session.phoneNumber,
      issueType: ctx.issueType,
      severity: ctx.severity,
    });

    // Create work order
    const workOrder: WorkOrderFromChat = {
      id: uuidv4(),
      tenantId: session.tenantId,
      propertyId: session.context.onboarding?.propertyId || '',
      unitId: session.context.onboarding?.unitId || '',
      issueType: ctx.issueType || 'Unspecified',
      description: ctx.issueDescription || ctx.issueType || 'No description provided',
      location: ctx.location || 'Not specified',
      severity: ctx.severity || 'medium',
      photoUrls: ctx.photoUrls || [],
      ...(ctx.voiceNoteUrl !== undefined ? { voiceNoteUrl: ctx.voiceNoteUrl } : {}),
      ...(ctx.transcribedText !== undefined ? { transcription: ctx.transcribedText } : {}),
      conversationId: session.id,
      status: 'pending_approval',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const result = await this.workOrderService.create(workOrder);
      ctx.workOrderId = result.ticketId;

      // Send confirmation
      const confirmationMessage = renderTemplate(
        getTemplate(MAINTENANCE_TEMPLATES.maintenanceConfirmation, session.language) as string,
        {
          issueType: ctx.issueType || 'Maintenance Issue',
          location: ctx.location || 'Not specified',
          severity: this.getSeverityLabel(ctx.severity || 'medium', session.language),
          ticketId: result.ticketId,
        }
      );
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: confirmationMessage });

      logger.info('Maintenance request submitted', {
        ticketId: result.ticketId,
        tenantId: session.tenantId,
      });
    } catch (error) {
      logger.error('Failed to create work order', { error });
      
      const errorMsg = session.language === 'sw'
        ? 'Samahani, kulikuwa na tatizo kutuma ombi lako. Tafadhali jaribu tena baadaye.'
        : 'Sorry, there was a problem submitting your request. Please try again later.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
    }

    session.state = 'maintenance_confirmation';
  }

  // ============================================================================
  // Status Updates
  // ============================================================================

  /**
   * Send technician assignment notification
   */
  async sendTechnicianAssignment(
    phoneNumber: string,
    language: SupportedLanguage,
    data: {
      ticketId: string;
      technicianName: string;
      technicianPhone: string;
      appointmentDate: string;
      appointmentTime: string;
    }
  ): Promise<void> {
    const message = renderTemplate(
      getTemplate(MAINTENANCE_TEMPLATES.technicianAssigned, language) as string,
      data
    );
    await this.whatsappClient.sendText({ to: phoneNumber, text: message });
  }

  /**
   * Send work completion notification with feedback request
   */
  async sendWorkCompletionNotification(
    phoneNumber: string,
    language: SupportedLanguage,
    data: {
      ticketId: string;
      workDescription: string;
    }
  ): Promise<void> {
    const message = renderTemplate(
      getTemplate(MAINTENANCE_TEMPLATES.workCompleted, language) as string,
      data
    );
    await this.whatsappClient.sendText({ to: phoneNumber, text: message });

    // Send feedback buttons
    const buttonTemplate = getTemplate(MAINTENANCE_TEMPLATES.workCompletedButtons, language);
    await this.whatsappClient.sendButtons(
      phoneNumber,
      (buttonTemplate as { body: string }).body,
      (buttonTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );
  }

  // ============================================================================
  // Emergency Handling
  // ============================================================================

  /**
   * Handle emergency maintenance issue (e.g., electrical sparks)
   */
  private async handleEmergencyIssue(
    session: ConversationSession,
    emergencyType: string
  ): Promise<void> {
    logger.warn('Emergency maintenance issue detected', {
      phoneNumber: session.phoneNumber,
      emergencyType,
    });

    // This will be handled by the EmergencyProtocolHandler
    // Mark the session state accordingly
    session.state = 'emergency_active';
    session.context.emergency = {
      emergencyType: emergencyType as any,
      description: `Emergency ${emergencyType} issue reported via maintenance flow`,
      reportedAt: new Date(),
      timelineEvents: [],
      resolved: false,
    };

    // Send immediate safety message
    const emergencyMsg = session.language === 'sw'
      ? '🚨 *DHARURA* - Tatizo la umeme linaweza kuwa hatari. Tafadhali:\n\n1. Zima swichi kuu ya umeme\n2. Usiguse waya au soketi\n3. Ondoka eneo hilo\n\nTimu yetu ya dharura inaariflwa SASA.'
      : '🚨 *EMERGENCY* - Electrical issues can be dangerous. Please:\n\n1. Turn off the main power switch\n2. Do not touch any wires or sockets\n3. Move away from the area\n\nOur emergency team is being notified NOW.';

    await this.whatsappClient.sendText({ to: session.phoneNumber, text: emergencyMsg });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Detect issue type from free-form text
   */
  private detectIssueType(text: string, language: SupportedLanguage): string | null {
    const lowerText = text.toLowerCase();

    // Plumbing keywords
    const plumbingKeywords = language === 'sw'
      ? ['maji', 'bomba', 'uvuja', 'choo', 'sinki', 'mfereji', 'ziba']
      : ['water', 'leak', 'pipe', 'toilet', 'sink', 'drain', 'blocked', 'clogged'];

    for (const keyword of plumbingKeywords) {
      if (lowerText.includes(keyword)) {
        return language === 'sw' ? 'Tatizo la Maji/Bomba' : 'Plumbing Issue';
      }
    }

    // Electrical keywords
    const electricalKeywords = language === 'sw'
      ? ['umeme', 'stima', 'soketi', 'swichi', 'mwanga', 'taa']
      : ['power', 'electric', 'socket', 'switch', 'light', 'outlet'];

    for (const keyword of electricalKeywords) {
      if (lowerText.includes(keyword)) {
        return language === 'sw' ? 'Tatizo la Umeme' : 'Electrical Issue';
      }
    }

    // Structural keywords
    const structuralKeywords = language === 'sw'
      ? ['mlango', 'dirisha', 'kufuli', 'ukuta', 'dari']
      : ['door', 'window', 'lock', 'wall', 'ceiling', 'roof'];

    for (const keyword of structuralKeywords) {
      if (lowerText.includes(keyword)) {
        return language === 'sw' ? 'Tatizo la Muundo' : 'Structural Issue';
      }
    }

    return null;
  }

  /**
   * Get severity label for display
   */
  private getSeverityLabel(severity: MaintenanceSeverity, language: SupportedLanguage): string {
    const labels: Record<MaintenanceSeverity, { en: string; sw: string }> = {
      low: { en: 'Low Priority', sw: 'Kipaumbele cha Chini' },
      medium: { en: 'Medium Priority', sw: 'Kipaumbele cha Kati' },
      high: { en: 'High Priority', sw: 'Kipaumbele cha Juu' },
      emergency: { en: 'EMERGENCY', sw: 'DHARURA' },
    };
    return labels[severity][language];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMaintenanceHandler(options: {
  whatsappClient: MetaWhatsAppClient;
  workOrderService: WorkOrderService;
  transcriptionService?: TranscriptionService;
}): MaintenanceRequestHandler {
  return new MaintenanceRequestHandler(options);
}
