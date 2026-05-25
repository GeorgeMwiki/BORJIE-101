/**
 * WhatsApp Webhook Router for BORJIE
 * Express router for handling WhatsApp Business API webhooks
 * Includes verification, message routing, and status updates
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger } from '../logger.js';
import { MetaWhatsAppClient, WebhookPayloadParseError } from './meta-client.js';
import { ConversationOrchestrator, TenantLookup, SessionStore } from './conversation-orchestrator.js';
import { MaintenanceRequestHandler, WorkOrderService, TranscriptionService } from './maintenance-handler.js';
import { FeedbackCollector, FeedbackService } from './feedback-collector.js';
import { EmergencyProtocolHandler, EmergencyService } from './emergency-handler.js';
import type {
  IncomingMessage,
  MessageStatusUpdate,
  WhatsAppWebhookPayload,
  ConversationSession,
  EmergencyContact,
  SupportedLanguage,
} from './types.js';
import { getEmergencyKeywords } from './templates.js';

const logger = createLogger('WhatsAppWebhook');

// ============================================================================
// Webhook Router Options
// ============================================================================

export interface WebhookRouterOptions {
  whatsappClient: MetaWhatsAppClient;
  tenantLookup: TenantLookup;
  sessionStore: SessionStore;
  workOrderService: WorkOrderService;
  feedbackService: FeedbackService;
  emergencyService: EmergencyService;
  transcriptionService?: TranscriptionService;
  defaultEmergencyContacts?: EmergencyContact[];
  validateSignature?: boolean;
  /**
   * Round-3 audit C9/C10 fix: admin/internal endpoints (`/send`,
   * `/send-template`, `/initiate-onboarding`, `/send-checkin`,
   * `/emergency`, GET/DELETE `/session/:phoneNumber`) MUST be protected.
   * Production wires this via the gateway's shared-secret middleware
   * (`x-borjie-internal-secret`); dev/tests can pass
   * `requireAdminAuth: false` to opt-out.
   *
   * The secret is read from `WHATSAPP_ADMIN_SECRET` by default; if
   * unset AND `requireAdminAuth !== false`, every admin route returns
   * 503 — fail-closed.
   */
  requireAdminAuth?: boolean;
  /** Override the admin secret. Defaults to env `WHATSAPP_ADMIN_SECRET`. */
  adminSecret?: string;
  /**
   * Round-3 audit C8 fix: webhook message-id dedupe store. If absent,
   * an in-memory LRU is used (good for single-pod; multi-pod must wire
   * a Redis-backed store).
   */
  webhookDedupeStore?: WebhookDedupeStore;
}

/**
 * Round-3 audit C8 fix — webhook idempotency.
 *
 * Meta retries POST /webhook on 5xx and timeouts, but the previous
 * router iterated `parsed.messages` and fired `processMessage` per item
 * with no dedupe. A retry meant the same state-machine transition was
 * applied twice (e.g. `12` answer interpreted twice → state advance one
 * step too far). The dedupe contract:
 *
 * - `seen(id)` returns true if the id has been seen in the dedupe
 *   window (default 24 h). Implementations should be atomic so two
 *   concurrent pods both calling `seen('msg-1')` produce only one
 *   `false`.
 * - The in-memory default uses an LRU; multi-pod deployments should
 *   wire Redis with `SET NX EX 86400`.
 */
export interface WebhookDedupeStore {
  /** Returns true iff `id` was previously seen within the TTL window. Atomically marks it seen if not. */
  seenAndMark(id: string): Promise<boolean> | boolean;
}

const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_CAP = 50_000;

/** In-memory LRU dedupe store — single-pod only. Multi-pod ⇒ wire Redis. */
export function createInMemoryWebhookDedupe(
  ttlMs: number = DEFAULT_DEDUPE_TTL_MS,
  cap: number = DEFAULT_DEDUPE_CAP,
): WebhookDedupeStore {
  const seen = new Map<string, number>(); // id → expiry ms

  function evictExpired(now: number): void {
    for (const [k, exp] of seen) {
      if (exp <= now) seen.delete(k);
    }
  }

  return {
    seenAndMark(id: string): boolean {
      const now = Date.now();
      evictExpired(now);
      const existing = seen.get(id);
      if (existing && existing > now) return true;
      seen.set(id, now + ttlMs);
      if (seen.size > cap) {
        // Drop oldest 10% by insertion order (Map preserves insertion).
        const dropCount = Math.floor(cap / 10);
        const it = seen.keys();
        for (let i = 0; i < dropCount; i++) {
          const next = it.next();
          if (next.done) break;
          seen.delete(next.value);
        }
      }
      return false;
    },
  };
}

// ============================================================================
// Message Status Handler Interface
// ============================================================================

export interface MessageStatusHandler {
  onSent?(messageId: string, recipientId: string): Promise<void>;
  onDelivered?(messageId: string, recipientId: string): Promise<void>;
  onRead?(messageId: string, recipientId: string): Promise<void>;
  onFailed?(messageId: string, recipientId: string, error: string): Promise<void>;
}

// ============================================================================
// Webhook Router Factory
// ============================================================================

export function createWebhookRouter(options: WebhookRouterOptions): Router {
  const router = Router();
  
  const {
    whatsappClient,
    tenantLookup,
    sessionStore,
    workOrderService,
    feedbackService,
    emergencyService,
    transcriptionService,
    defaultEmergencyContacts = [],
    validateSignature = true,
    requireAdminAuth = true,
    adminSecret = process.env.WHATSAPP_ADMIN_SECRET,
    webhookDedupeStore = createInMemoryWebhookDedupe(),
  } = options;

  // Initialize handlers
  const orchestrator = new ConversationOrchestrator({
    whatsappClient,
    sessionStore,
    tenantLookup,
    sessionTimeoutMinutes: 30,
  });

  const maintenanceHandler = new MaintenanceRequestHandler({
    whatsappClient,
    workOrderService,
    transcriptionService,
  });

  const feedbackCollector = new FeedbackCollector({
    whatsappClient,
    feedbackService,
  });

  const emergencyHandler = new EmergencyProtocolHandler({
    whatsappClient,
    emergencyService,
    emergencyKeywords: getEmergencyKeywords(),
    defaultEmergencyContacts,
  });

  // Message status handler (can be overridden)
  let statusHandler: MessageStatusHandler = {};

  // ============================================================================
  // Middleware: Signature Validation
  // ============================================================================

  const validateWebhookSignature = (req: Request, res: Response, next: NextFunction): void => {
    if (!validateSignature) {
      next();
      return;
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) {
      logger.warn('Missing webhook signature');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (!rawBody) {
      logger.warn('Missing raw body for signature validation');
      res.status(400).json({ error: 'Missing body' });
      return;
    }

    const isValid = whatsappClient.validateWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn('Invalid webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  };

  // ============================================================================
  // Middleware: Admin Auth (round-3 C9 + C10)
  // ============================================================================
  //
  // The `/send`, `/send-template`, `/initiate-onboarding`, `/send-checkin`,
  // `/emergency`, GET/DELETE `/session/:phoneNumber` endpoints were
  // previously unauthenticated. Two attack surfaces:
  //
  //   1. Outbound WhatsApp fan-out from BORJIE's Meta account to
  //      arbitrary numbers (cost + reputation + abuse-of-trust).
  //   2. Phone-number-existence oracle via session GET (info disclosure).
  //
  // The middleware compares the `x-borjie-internal-secret` header
  // against the configured secret using `crypto.timingSafeEqual` (after
  // length-normalising — see the meta-client C2 fix for the same
  // pattern). Pass `requireAdminAuth: false` for dev/test mounts.

  const requireAdminAuthMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (!requireAdminAuth) {
      next();
      return;
    }

    if (!adminSecret) {
      logger.error(
        'WHATSAPP_ADMIN_SECRET missing — admin endpoint rejected. ' +
          'Set the env var or mount the router with requireAdminAuth: false.'
      );
      res.status(503).json({ error: 'Admin auth not configured' });
      return;
    }

    const provided = req.headers['x-borjie-internal-secret'];
    const providedStr =
      typeof provided === 'string'
        ? provided
        : Array.isArray(provided)
          ? provided[0]
          : '';

    if (!providedStr) {
      res.status(401).json({ error: 'Missing admin secret' });
      return;
    }

    try {
      const a = Buffer.from(providedStr, 'utf8');
      const b = Buffer.from(adminSecret, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Invalid admin secret' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid admin secret' });
      return;
    }

    next();
  };

  // ============================================================================
  // GET /webhook - Verification Endpoint
  // ============================================================================

  router.get('/webhook', (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'] as string;
    const token = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    logger.info('Webhook verification request', { mode });

    const result = whatsappClient.verifyWebhook(mode, token, challenge);
    
    if (result) {
      logger.info('Webhook verified successfully');
      res.status(200).send(result);
    } else {
      logger.warn('Webhook verification failed');
      res.status(403).send('Forbidden');
    }
  });

  // ============================================================================
  // POST /webhook - Message & Status Handler
  // ============================================================================

  router.post('/webhook', validateWebhookSignature, async (req: Request, res: Response): Promise<void> => {
    // Round-3 audit C3 + C8 fix: parse BEFORE sending 200 so a malformed
    // body returns 400 (Meta retries) instead of being silently dropped;
    // dedupe message ids so retries don't double-process state machines.
    let parsed: {
      messages: IncomingMessage[];
      statuses: MessageStatusUpdate[];
      contacts: Array<{ wa_id: string; name: string }>;
    };
    try {
      parsed = whatsappClient.parseWebhookPayload(req.body as WhatsAppWebhookPayload);
    } catch (error) {
      if (error instanceof WebhookPayloadParseError) {
        logger.warn('Rejecting malformed webhook payload — Meta will retry', {
          reason: error.message,
        });
        res.status(400).json({ error: 'Malformed webhook payload' });
        return;
      }
      logger.error('Unexpected webhook parse error', { error });
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    // Respond now — downstream processing is async + idempotent.
    res.status(200).send('EVENT_RECEIVED');

    // Process messages
    for (const message of parsed.messages) {
      try {
        const dupeSeen = await Promise.resolve(
          webhookDedupeStore.seenAndMark(`msg:${message.id}`)
        );
        if (dupeSeen) {
          logger.info('Skipping duplicate webhook message', { messageId: message.id });
          continue;
        }
      } catch (dedupeErr) {
        // Fail-open on dedupe-store outage but log loudly.
        logger.error('Webhook dedupe store failed; processing anyway', {
          messageId: message.id,
          error: dedupeErr,
        });
      }

      const contactName = parsed.contacts.find(c => c.wa_id === message.from)?.name;
      processMessage(message, contactName).catch(error => {
        logger.error('Failed to process message', {
          messageId: message.id,
          error,
        });
      });
    }

    // Process status updates with status-tuple dedupe (M6)
    for (const status of parsed.statuses) {
      try {
        const dupeKey = `status:${status.id}:${status.status}`;
        const dupeSeen = await Promise.resolve(webhookDedupeStore.seenAndMark(dupeKey));
        if (dupeSeen) continue;
      } catch (dedupeErr) {
        logger.error('Webhook dedupe store failed for status; processing anyway', {
          messageId: status.id,
          error: dedupeErr,
        });
      }
      processStatus(status).catch(error => {
        logger.error('Failed to process status', {
          messageId: status.id,
          error,
        });
      });
    }
  });

  // ============================================================================
  // Message Processing
  // ============================================================================

  async function processMessage(message: IncomingMessage, senderName?: string): Promise<void> {
    const phoneNumber = message.from;
    
    logger.info('Processing message', {
      from: phoneNumber,
      type: message.type,
      messageId: message.id,
    });

    // Get or create session
    let session = await sessionStore.get(phoneNumber);
    const tenant = await tenantLookup.findByPhone(phoneNumber);

    if (!session) {
      session = createNewSession(phoneNumber, tenant, senderName);
      await sessionStore.set(session);
    }

    // Check for emergency first (highest priority)
    const text = extractTextContent(message);
    if (text) {
      const emergencyCheck = emergencyHandler.detectEmergency(text, session.language);
      if (emergencyCheck.isEmergency && emergencyCheck.confidence === 'high') {
        await emergencyHandler.handleMessage(session, message);
        await sessionStore.set(session);
        return;
      }
    }

    // Route based on session state
    const state = session.state;

    // Maintenance flow states
    if (state.startsWith('maintenance_')) {
      await maintenanceHandler.handleMessage(session, message);
      await sessionStore.set(session);
      return;
    }

    // Feedback flow states
    if (state.startsWith('feedback_')) {
      await feedbackCollector.handleMessage(session, message);
      await sessionStore.set(session);
      return;
    }

    // Emergency flow states
    if (state === 'emergency_active') {
      await emergencyHandler.handleMessage(session, message);
      await sessionStore.set(session);
      return;
    }

    // Check for command keywords
    if (text) {
      const lowerText = text.toLowerCase();

      // Maintenance keywords
      if (lowerText.includes('maintenance') || lowerText.includes('repair') ||
          lowerText.includes('broken') || lowerText.includes('leak') ||
          lowerText.includes('matengenezo') || lowerText.includes('ukarabati')) {
        session.state = 'maintenance_intake';
        await maintenanceHandler.startMaintenanceFlow(session);
        await sessionStore.set(session);
        return;
      }

      // Feedback keywords
      if (lowerText.includes('feedback') || lowerText.includes('complaint') ||
          lowerText.includes('maoni') || lowerText.includes('malalamiko')) {
        await feedbackCollector.startFeedbackFlow(session, 'general');
        await sessionStore.set(session);
        return;
      }
    }

    // Default to conversation orchestrator
    await orchestrator.handleMessage(message, senderName);
    
    // Refresh session after orchestrator processing
    const updatedSession = await sessionStore.get(phoneNumber);
    if (updatedSession) {
      session = updatedSession;
    }
    await sessionStore.set(session);
  }

  // ============================================================================
  // Status Processing
  // ============================================================================

  async function processStatus(status: MessageStatusUpdate): Promise<void> {
    logger.debug('Processing status update', {
      messageId: status.id,
      status: status.status,
      recipientId: status.recipient_id,
    });

    switch (status.status) {
      case 'sent':
        await statusHandler.onSent?.(status.id, status.recipient_id);
        break;
      case 'delivered':
        await statusHandler.onDelivered?.(status.id, status.recipient_id);
        break;
      case 'read':
        await statusHandler.onRead?.(status.id, status.recipient_id);
        break;
      case 'failed': {
        const errorMsg = status.errors?.[0]?.message || 'Unknown error';
        await statusHandler.onFailed?.(status.id, status.recipient_id, errorMsg);
        break;
      }
    }
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  function createNewSession(
    phoneNumber: string,
    tenant: Awaited<ReturnType<TenantLookup['findByPhone']>>,
    senderName?: string
  ): ConversationSession {
    const { v4: uuidv4 } = require('uuid');
    
    return {
      id: uuidv4(),
      tenantId: tenant?.tenantId || '',
      phoneNumber,
      state: 'idle',
      language: (tenant?.preferredLanguage || 'en') as SupportedLanguage,
      context: {
        onboarding: tenant ? {
          tenantName: tenant.name,
          propertyId: tenant.propertyId,
          unitId: tenant.unitId,
          step: 0,
          completedSteps: [],
        } : undefined,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      messageHistory: [],
    };
  }

  function extractTextContent(message: IncomingMessage): string | null {
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

  // ============================================================================
  // Additional Endpoints
  // ============================================================================

  /**
   * Health check endpoint
   */
  router.get('/health', (req: Request, res: Response): void => {
    res.json({
      status: 'ok',
      service: 'whatsapp-webhook',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Send proactive message (internal API)
   */
  router.post('/send', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const { phoneNumber, message, type = 'text' } = req.body;

      if (!phoneNumber || !message) {
        res.status(400).json({ error: 'Missing phoneNumber or message' });
        return;
      }

      if (type === 'text') {
        const result = await whatsappClient.sendText({ to: phoneNumber, text: message });
        res.json({ success: true, messageId: result.messages[0]?.id });
      } else {
        res.status(400).json({ error: 'Unsupported message type' });
      }
    } catch (error) {
      logger.error('Failed to send message', { error });
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  /**
   * Send template message (internal API)
   */
  router.post('/send-template', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const { phoneNumber, templateName, languageCode, components } = req.body;

      if (!phoneNumber || !templateName) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const result = await whatsappClient.sendTemplate({
        to: phoneNumber,
        templateName,
        languageCode: languageCode || 'en',
        components,
      });

      res.json({ success: true, messageId: result.messages[0]?.id });
    } catch (error) {
      logger.error('Failed to send template', { error });
      res.status(500).json({ error: 'Failed to send template' });
    }
  });

  /**
   * Initiate onboarding for a tenant
   */
  router.post('/initiate-onboarding', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const { tenantId } = req.body;

      if (!tenantId) {
        res.status(400).json({ error: 'Missing tenantId' });
        return;
      }

      // nosemgrep: missing-tenant-id-arg reason: `tenantLookup` is the tenants table — the lookup IS the tenant; the local `tenantId` IS the key.
      const tenant = await tenantLookup.findById(tenantId);
      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      await orchestrator.initiateOnboarding(tenant);
      res.json({ success: true, message: 'Onboarding initiated' });
    } catch (error) {
      logger.error('Failed to initiate onboarding', { error });
      res.status(500).json({ error: 'Failed to initiate onboarding' });
    }
  });

  /**
   * Send feedback check-in
   */
  router.post('/send-checkin', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const { phoneNumber, tenantName, propertyName, type, language } = req.body;

      if (!phoneNumber || !tenantName || !propertyName || !type) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      if (type === 'day3') {
        await feedbackCollector.sendDay3CheckIn(phoneNumber, tenantName, propertyName, language || 'en');
      } else if (type === 'day10') {
        await feedbackCollector.sendDay10CheckIn(phoneNumber, tenantName, propertyName, language || 'en');
      } else {
        res.status(400).json({ error: 'Invalid check-in type' });
        return;
      }

      res.json({ success: true, message: `${type} check-in sent` });
    } catch (error) {
      logger.error('Failed to send check-in', { error });
      res.status(500).json({ error: 'Failed to send check-in' });
    }
  });

  /**
   * Trigger emergency escalation manually
   */
  router.post('/emergency', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const { phoneNumber, tenantId, emergencyType, description, language } = req.body;

      if (!phoneNumber || !tenantId || !emergencyType || !description) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      await emergencyHandler.manualEscalation(
        phoneNumber,
        tenantId,
        emergencyType,
        description,
        language || 'en'
      );

      res.json({ success: true, message: 'Emergency escalation triggered' });
    } catch (error) {
      logger.error('Failed to trigger emergency', { error });
      res.status(500).json({ error: 'Failed to trigger emergency' });
    }
  });

  /**
   * Get session info
   */
  router.get('/session/:phoneNumber', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const phoneNumber = req.params.phoneNumber ?? '';
      const session = await sessionStore.get(phoneNumber);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({
        id: session.id,
        tenantId: session.tenantId,
        state: session.state,
        language: session.language,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      logger.error('Failed to get session', { error });
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  /**
   * Clear session
   */
  router.delete('/session/:phoneNumber', requireAdminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
    try {
      const phoneNumber = req.params.phoneNumber ?? '';
      await sessionStore.delete(phoneNumber);
      res.json({ success: true, message: 'Session cleared' });
    } catch (error) {
      logger.error('Failed to clear session', { error });
      res.status(500).json({ error: 'Failed to clear session' });
    }
  });

  // ============================================================================
  // Set Status Handler
  // ============================================================================

  /**
   * Set custom message status handler
   */
  (router as Router & { setStatusHandler: (handler: MessageStatusHandler) => void }).setStatusHandler = (handler: MessageStatusHandler): void => {
    statusHandler = handler;
  };

  return router;
}

// ============================================================================
// Raw Body Middleware (for signature validation)
// ============================================================================

export function rawBodyMiddleware(
  req: Request & { rawBody?: string },
  res: Response,
  next: NextFunction
): void {
  let data = '';
  
  req.setEncoding('utf8');
  
  req.on('data', (chunk: string) => {
    data += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = data;
    try {
      req.body = JSON.parse(data);
    } catch {
      req.body = {};
    }
    next();
  });
}
