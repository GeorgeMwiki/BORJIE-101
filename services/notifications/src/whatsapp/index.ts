/**
 * WhatsApp Business API Module for BORJIE
 * 
 * Comprehensive WhatsApp integration for East African property management:
 * - Meta WhatsApp Business API Client
 * - Conversation Orchestrator (onboarding flows)
 * - Maintenance Request Handler (work order creation)
 * - Feedback Collector (satisfaction surveys)
 * - Reminder Engine (rent, appointments, documents)
 * - Emergency Protocol Handler (safety incidents)
 * - Bilingual Templates (English/Swahili)
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Base types
  SupportedLanguage,
  ConversationState,
  MessagePriority,
  MessageStatus,
  MaintenanceSeverity,
  EmergencyType,

  // Session types
  ConversationSession,
  ConversationContext,
  OnboardingContext,
  MaintenanceContext,
  FeedbackContext,
  EmergencyContext,
  EmergencyTimelineEvent,
  MessageHistoryItem,

  // Webhook types
  WhatsAppWebhookPayload,
  WebhookEntry,
  WebhookChange,
  WebhookValue,
  WebhookContact,
  IncomingMessage,
  IncomingMessageType,
  MediaContent,
  LocationContent,
  ContactContent,
  InteractiveReply,
  ButtonReply,
  MessageContext,
  MessageStatusUpdate,
  WebhookError,

  // Outgoing message types
  OutgoingTextMessage,
  OutgoingTemplateMessage,
  TemplateComponent,
  TemplateParameter,
  CurrencyParameter,
  DateTimeParameter,
  MediaParameter,
  DocumentParameter,
  OutgoingMediaMessage,
  OutgoingInteractiveMessage,
  InteractiveHeader,
  InteractiveButton,
  InteractiveSection,
  InteractiveRow,
  OutgoingLocationMessage,

  // API response types
  SendMessageResponse,
  MediaUploadResponse,
  MediaDownloadResponse,

  // Reminder types
  ReminderSchedule,
  ReminderType,
  ReminderData,

  // Domain types
  WorkOrderFromChat,
  FeedbackFromChat,
  EmergencyIncident,

  // NLP types
  ExtractedIntent,
  IntentType,
  ExtractedEntity,
  EntityType,

  // Configuration types
  WhatsAppBusinessConfig,
  EmergencyContact,
} from './types.js';

// ============================================================================
// Meta WhatsApp Client
// ============================================================================

export {
  MetaWhatsAppClient,
  metaWhatsAppClient,
  WhatsAppAPIError,
  WhatsAppRateLimitError,
} from './meta-client.js';

// ============================================================================
// Legacy WhatsApp Client (for backward compatibility)
// ============================================================================

export {
  WhatsAppClient,
  whatsAppClient,
  type WhatsAppConfig,
  type TextMessage,
  type TemplateMessage,
  type MediaMessage,
  type InteractiveMessage,
  type WebhookMessage,
} from './client.js';

// ============================================================================
// Conversation Orchestrator
// ============================================================================

export {
  ConversationOrchestrator,
  createConversationOrchestrator,
  InMemorySessionStore,
  type SessionStore,
  type TenantLookup,
  type TenantInfo,
  type OnboardingStatus,
} from './conversation-orchestrator.js';

// ============================================================================
// Maintenance Handler
// ============================================================================

export {
  MaintenanceRequestHandler,
  createMaintenanceHandler,
  type WorkOrderService,
  type TranscriptionService,
} from './maintenance-handler.js';

// ============================================================================
// Feedback Collector
// ============================================================================

export {
  FeedbackCollector,
  createFeedbackCollector,
  type FeedbackService,
} from './feedback-collector.js';

// ============================================================================
// Reminder Engine
// ============================================================================

export {
  ReminderEngine,
  createReminderEngine,
  InMemoryReminderQueue,
  type ReminderQueue,
  type TenantDataProvider,
} from './reminder-engine.js';

// ============================================================================
// Emergency Handler
// ============================================================================

export {
  EmergencyProtocolHandler,
  createEmergencyHandler,
  type EmergencyService,
} from './emergency-handler.js';

// ============================================================================
// Webhook Router
// ============================================================================

export {
  createWebhookRouter,
  rawBodyMiddleware,
  type WebhookRouterOptions,
  type MessageStatusHandler,
} from './webhook-router.js';

// ============================================================================
// Templates
// ============================================================================

export {
  // Template collections
  ONBOARDING_TEMPLATES,
  MAINTENANCE_TEMPLATES,
  FEEDBACK_TEMPLATES,
  REMINDER_TEMPLATES,
  EMERGENCY_TEMPLATES,
  GENERAL_TEMPLATES,

  // Template types
  type MessageTemplate,
  type InteractiveTemplate,

  // Template utilities
  getTemplate,
  renderTemplate,
  getEmergencyKeywords,
  detectLanguage,
} from './templates.js';
