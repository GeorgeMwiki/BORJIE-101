/**
 * Feedback Collector for BORJIE
 * Handles Module B - Feedback Engine & Engagement workflows via WhatsApp
 * Day 3 and Day 10 check-ins, structured sentiment extraction, service recovery
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../logger.js';
import { MetaWhatsAppClient } from './meta-client.js';
import {
  FEEDBACK_TEMPLATES,
  renderTemplate,
  getTemplate,
} from './templates.js';
import type {
  ConversationSession,
  FeedbackContext,
  FeedbackFromChat,
  SupportedLanguage,
  IncomingMessage,
} from './types.js';

const logger = createLogger('FeedbackCollector');

// ============================================================================
// Rating Mapping
// ============================================================================

const RATING_MAP: Record<string, number> = {
  'rating_1_2': 1,
  'rating_3': 3,
  'rating_4_5': 5,
};

// ============================================================================
// Feedback Service Interface
// ============================================================================

export interface FeedbackService {
  create(feedback: FeedbackFromChat): Promise<{ feedbackId: string }>;
  triggerServiceRecovery(feedback: FeedbackFromChat): Promise<void>;
  analyzeSentiment(text: string, language: SupportedLanguage): Promise<{
    sentiment: 'positive' | 'neutral' | 'negative';
    score: number;
    issues: string[];
  }>;
}

// ============================================================================
// Feedback Collector
// ============================================================================

export class FeedbackCollector {
  private whatsappClient: MetaWhatsAppClient;
  private feedbackService: FeedbackService;

  constructor(options: {
    whatsappClient: MetaWhatsAppClient;
    feedbackService: FeedbackService;
  }) {
    this.whatsappClient = options.whatsappClient;
    this.feedbackService = options.feedbackService;
  }

  // ============================================================================
  // Check-in Triggers
  // ============================================================================

  /**
   * Send Day 3 check-in message
   */
  async sendDay3CheckIn(
    phoneNumber: string,
    tenantName: string,
    propertyName: string,
    language: SupportedLanguage = 'en'
  ): Promise<void> {
    logger.info('Sending Day 3 check-in', { phoneNumber, tenantName });

    const message = renderTemplate(
      getTemplate(FEEDBACK_TEMPLATES.day3Checkin, language) as string,
      { tenantName, propertyName }
    );
    await this.whatsappClient.sendText({ to: phoneNumber, text: message });

    // Send rating buttons
    const ratingTemplate = getTemplate(FEEDBACK_TEMPLATES.ratingRequest, language);
    await this.whatsappClient.sendButtons(
      phoneNumber,
      (ratingTemplate as { body: string }).body,
      (ratingTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );
  }

  /**
   * Send Day 10 check-in message
   */
  async sendDay10CheckIn(
    phoneNumber: string,
    tenantName: string,
    propertyName: string,
    language: SupportedLanguage = 'en'
  ): Promise<void> {
    logger.info('Sending Day 10 check-in', { phoneNumber, tenantName });

    const message = renderTemplate(
      getTemplate(FEEDBACK_TEMPLATES.day10Checkin, language) as string,
      { tenantName, propertyName }
    );
    await this.whatsappClient.sendText({ to: phoneNumber, text: message });

    // Send issue check list
    const listTemplate = getTemplate(FEEDBACK_TEMPLATES.issueCheckList, language);
    await this.whatsappClient.sendList(
      phoneNumber,
      (listTemplate as { body: string }).body,
      (listTemplate as { sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }).sections,
      {
        header: { type: 'text', text: (listTemplate as { header?: string }).header },
      }
    );
  }

  /**
   * Send post-maintenance feedback request
   */
  async sendPostMaintenanceFeedback(
    phoneNumber: string,
    tenantName: string,
    ticketId: string,
    language: SupportedLanguage = 'en'
  ): Promise<void> {
    logger.info('Sending post-maintenance feedback request', { phoneNumber, ticketId });

    const message = language === 'sw'
      ? `Habari ${tenantName}! Ombi lako la matengenezo #${ticketId} limekamilika.\n\nTungependa kusikia uzoefu wako. Ulikuwa na furaha na huduma?`
      : `Hi ${tenantName}! Your maintenance request #${ticketId} has been completed.\n\nWe'd love to hear about your experience. Were you satisfied with the service?`;

    await this.whatsappClient.sendText({ to: phoneNumber, text: message });

    // Send rating buttons
    const ratingTemplate = getTemplate(FEEDBACK_TEMPLATES.ratingRequest, language);
    await this.whatsappClient.sendButtons(
      phoneNumber,
      (ratingTemplate as { body: string }).body,
      (ratingTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );
  }

  // ============================================================================
  // Message Handler
  // ============================================================================

  /**
   * Handle feedback-related messages
   */
  async handleMessage(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    // Initialize feedback context if needed
    if (!session.context.feedback) {
      session.context.feedback = {
        feedbackType: 'general',
        step: 1,
        issues: [],
      };
    }

    const state = session.state;

    switch (state) {
      case 'feedback_rating':
        await this.handleRating(session, message);
        break;

      case 'feedback_comment':
        await this.handleComment(session, message);
        break;

      default:
        // Start feedback flow with rating
        await this.startFeedbackFlow(session);
    }
  }

  /**
   * Start feedback collection flow
   */
  async startFeedbackFlow(
    session: ConversationSession,
    feedbackType: FeedbackContext['feedbackType'] = 'general'
  ): Promise<void> {
    session.context.feedback = {
      feedbackType,
      step: 1,
      issues: [],
    };

    // Send rating request
    const ratingTemplate = getTemplate(FEEDBACK_TEMPLATES.ratingRequest, session.language);
    await this.whatsappClient.sendButtons(
      session.phoneNumber,
      (ratingTemplate as { body: string }).body,
      (ratingTemplate as { buttons: Array<{ id: string; title: string }> }).buttons
    );

    session.state = 'feedback_rating';
  }

  /**
   * Handle rating response
   */
  private async handleRating(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.feedback!;
    let rating = 3; // Default to neutral

    // Check for button reply
    if (message.type === 'interactive' && message.interactive?.button_reply) {
      const selectedId = message.interactive.button_reply.id;
      rating = RATING_MAP[selectedId] || 3;
    }

    // Check for list reply (issue selection)
    if (message.type === 'interactive' && message.interactive?.list_reply) {
      const selectedId = message.interactive.list_reply.id;
      
      if (selectedId === 'no_issues') {
        rating = 5;
        ctx.issues = [];
      } else {
        // Issue selected - mark as potential problem
        rating = 2;
        ctx.issues = ctx.issues || [];
        ctx.issues.push(this.mapIssueIdToLabel(selectedId, session.language));
      }
    }

    // Check for text rating
    if (message.type === 'text' && message.text?.body) {
      const text = message.text.body.toLowerCase();
      const numMatch = text.match(/\d/);
      
      if (numMatch) {
        rating = Math.min(5, Math.max(1, parseInt(numMatch[0], 10)));
      } else if (text.includes('great') || text.includes('excellent') || text.includes('nzuri sana')) {
        rating = 5;
      } else if (text.includes('good') || text.includes('okay') || text.includes('sawa')) {
        rating = 4;
      } else if (text.includes('bad') || text.includes('poor') || text.includes('mbaya')) {
        rating = 2;
      } else if (text.includes('terrible') || text.includes('awful') || text.includes('mbaya sana')) {
        rating = 1;
      }
    }

    ctx.rating = rating;
    ctx.step = 2;

    // Determine sentiment from rating
    if (rating <= 2) {
      ctx.sentiment = 'negative';
    } else if (rating === 3) {
      ctx.sentiment = 'neutral';
    } else {
      ctx.sentiment = 'positive';
    }

    // For low ratings, show issue checklist
    if (rating <= 3 && (!ctx.issues || ctx.issues.length === 0)) {
      const listTemplate = getTemplate(FEEDBACK_TEMPLATES.issueCheckList, session.language);
      await this.whatsappClient.sendList(
        session.phoneNumber,
        (listTemplate as { body: string }).body,
        (listTemplate as { sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> }).sections,
        {
          header: { type: 'text', text: (listTemplate as { header?: string }).header },
        }
      );
      return;
    }

    // Ask for additional comments
    const commentMessage = getTemplate(FEEDBACK_TEMPLATES.additionalComments, session.language) as string;
    await this.whatsappClient.sendText({ to: session.phoneNumber, text: commentMessage });

    session.state = 'feedback_comment';
  }

  /**
   * Handle comment/additional feedback
   */
  private async handleComment(
    session: ConversationSession,
    message: IncomingMessage
  ): Promise<void> {
    const ctx = session.context.feedback!;
    let comment: string | undefined;

    if (message.type === 'text' && message.text?.body) {
      const text = message.text.body.toLowerCase();
      
      if (text !== 'skip' && text !== 'ruka' && text !== 'no' && text !== 'hapana') {
        comment = message.text.body;
        ctx.comment = comment;

        // Analyze sentiment from comment
        try {
          const analysis = await this.feedbackService.analyzeSentiment(comment, session.language);
          
          // Update sentiment if comment reveals more
          if (analysis.sentiment === 'negative' && ctx.sentiment !== 'negative') {
            ctx.sentiment = 'negative';
          }
          
          // Add detected issues
          if (analysis.issues.length > 0) {
            ctx.issues = [...(ctx.issues || []), ...analysis.issues];
          }
        } catch (error) {
          logger.error('Failed to analyze sentiment', { error });
        }
      }
    }

    // Handle voice note
    if (message.type === 'audio' && message.audio) {
      try {
        const mediaInfo = await this.whatsappClient.getMediaUrl(message.audio.id);
        ctx.comment = `[Voice note: ${mediaInfo.url}]`;
      } catch (error) {
        logger.error('Failed to process voice note', { error });
      }
    }

    // Submit feedback
    await this.submitFeedback(session);
  }

  /**
   * Submit collected feedback
   */
  private async submitFeedback(session: ConversationSession): Promise<void> {
    const ctx = session.context.feedback!;

    const feedback: FeedbackFromChat = {
      id: uuidv4(),
      tenantId: session.tenantId,
      type: ctx.feedbackType,
      rating: ctx.rating || 3,
      comment: ctx.comment,
      sentiment: ctx.sentiment || 'neutral',
      issues: ctx.issues || [],
      requiresFollowUp: (ctx.rating || 3) <= 2 || ctx.sentiment === 'negative',
      conversationId: session.id,
      createdAt: new Date(),
    };

    try {
      await this.feedbackService.create(feedback);
      
      logger.info('Feedback submitted', {
        feedbackId: feedback.id,
        tenantId: session.tenantId,
        rating: feedback.rating,
        sentiment: feedback.sentiment,
      });

      // Determine follow-up message
      let followUpMessage = '';

      if (feedback.requiresFollowUp) {
        // Trigger service recovery
        await this.feedbackService.triggerServiceRecovery(feedback);
        
        const recoveryMessage = renderTemplate(
          getTemplate(FEEDBACK_TEMPLATES.serviceRecovery, session.language) as string,
          { responseTime: session.language === 'sw' ? 'masaa 24' : '24 hours' }
        );
        await this.whatsappClient.sendText({ to: session.phoneNumber, text: recoveryMessage });
        
        followUpMessage = session.language === 'sw'
          ? 'Timu yetu itawasiliana nawe hivi karibuni kuhusu wasiwasi wako.'
          : 'Our team will reach out to you shortly regarding your concerns.';
      } else {
        followUpMessage = session.language === 'sw'
          ? 'Tunafurahi kusikia unafurahia kukaa hapa!'
          : 'We\'re glad to hear you\'re enjoying your stay!';
      }

      // Send thank you message
      const thanksMessage = renderTemplate(
        getTemplate(FEEDBACK_TEMPLATES.feedbackThanks, session.language) as string,
        { followUpMessage }
      );
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: thanksMessage });

    } catch (error) {
      logger.error('Failed to submit feedback', { error });
      
      const errorMsg = session.language === 'sw'
        ? 'Asante kwa maoni yako! Tumepokea ujumbe wako.'
        : 'Thank you for your feedback! We\'ve received your message.';
      await this.whatsappClient.sendText({ to: session.phoneNumber, text: errorMsg });
    }

    // Reset session state
    session.state = 'feedback_complete';
    session.context.feedback = undefined;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Map issue ID to human-readable label
   */
  private mapIssueIdToLabel(issueId: string, language: SupportedLanguage): string {
    const issueMap: Record<string, { en: string; sw: string }> = {
      'issue_water': { en: 'Water Supply', sw: 'Ugavi wa Maji' },
      'issue_electricity': { en: 'Electricity', sw: 'Umeme' },
      'issue_internet': { en: 'Internet/WiFi', sw: 'Mtandao/WiFi' },
      'issue_noise': { en: 'Noise/Neighbors', sw: 'Kelele/Majirani' },
      'issue_security': { en: 'Security', sw: 'Usalama' },
      'issue_cleanliness': { en: 'Cleanliness', sw: 'Usafi' },
    };

    return issueMap[issueId]?.[language] || issueId;
  }

  // ============================================================================
  // Scheduled Check-ins
  // ============================================================================

  /**
   * Schedule Day 3 and Day 10 check-ins for a tenant
   */
  async scheduleCheckIns(
    tenantId: string,
    phoneNumber: string,
    tenantName: string,
    propertyName: string,
    moveInDate: Date,
    language: SupportedLanguage = 'en'
  ): Promise<{ day3: Date; day10: Date }> {
    const day3 = new Date(moveInDate);
    day3.setDate(day3.getDate() + 3);
    day3.setHours(10, 0, 0, 0); // 10 AM

    const day10 = new Date(moveInDate);
    day10.setDate(day10.getDate() + 10);
    day10.setHours(10, 0, 0, 0); // 10 AM

    logger.info('Scheduled check-ins', {
      tenantId,
      day3: day3.toISOString(),
      day10: day10.toISOString(),
    });

    // In production, this would schedule jobs in a queue
    // For now, return the dates for external scheduling

    return { day3, day10 };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createFeedbackCollector(options: {
  whatsappClient: MetaWhatsAppClient;
  feedbackService: FeedbackService;
}): FeedbackCollector {
  return new FeedbackCollector(options);
}
