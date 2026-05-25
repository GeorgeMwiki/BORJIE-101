/**
 * WhatsApp Business API Types for BORJIE
 * Comprehensive type definitions for conversation orchestration
 */

// ============================================================================
// Base Types
// ============================================================================

export type SupportedLanguage = 'en' | 'sw';
export type ConversationState = 
  | 'idle'
  | 'onboarding_welcome'
  | 'onboarding_language'
  | 'onboarding_move_in_date'
  | 'onboarding_occupants'
  | 'onboarding_emergency_contact'
  | 'onboarding_confirmation'
  | 'onboarding_complete'
  | 'maintenance_intake'
  | 'maintenance_location'
  | 'maintenance_severity'
  | 'maintenance_photo'
  | 'maintenance_confirmation'
  | 'feedback_rating'
  | 'feedback_comment'
  | 'feedback_complete'
  | 'emergency_active'
  | 'awaiting_response';

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type MaintenanceSeverity = 'low' | 'medium' | 'high' | 'emergency';
export type EmergencyType = 'fire' | 'flooding' | 'break_in' | 'gas_leak' | 'electrical' | 'medical' | 'other';

// ============================================================================
// Conversation Session
// ============================================================================

export interface ConversationSession {
  id: string;
  tenantId: string;
  phoneNumber: string;
  state: ConversationState;
  language: SupportedLanguage;
  context: ConversationContext;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  messageHistory: MessageHistoryItem[];
}

export interface ConversationContext {
  // Onboarding context
  onboarding?: OnboardingContext;
  // Maintenance context
  maintenance?: MaintenanceContext;
  // Feedback context
  feedback?: FeedbackContext;
  // Emergency context
  emergency?: EmergencyContext;
  // Generic data
  data?: Record<string, unknown>;
}

export interface OnboardingContext {
  tenantName?: string;
  propertyId?: string;
  unitId?: string;
  moveInDate?: string;
  numberOfOccupants?: number;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  preferredLanguage?: SupportedLanguage;
  step: number;
  completedSteps: string[];
}

export interface MaintenanceContext {
  issueType?: string;
  issueDescription?: string;
  location?: string;
  severity?: MaintenanceSeverity;
  photoUrls?: string[];
  voiceNoteUrl?: string;
  transcribedText?: string;
  workOrderId?: string;
  step: number;
}

export interface FeedbackContext {
  feedbackType: 'day_3_checkin' | 'day_10_checkin' | 'post_maintenance' | 'general';
  rating?: number;
  comment?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  issues?: string[];
  step: number;
}

export interface EmergencyContext {
  emergencyType: EmergencyType;
  description: string;
  location?: string;
  reportedAt: Date;
  escalatedTo?: string[];
  timelineEvents: EmergencyTimelineEvent[];
  resolved: boolean;
}

export interface EmergencyTimelineEvent {
  timestamp: Date;
  event: string;
  actor: string;
  details?: string;
}

export interface MessageHistoryItem {
  id: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'audio' | 'document' | 'interactive' | 'template';
  content: string;
  timestamp: Date;
  status: MessageStatus;
}

// ============================================================================
// Incoming Webhook Types
// ============================================================================

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: 'whatsapp';
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WebhookContact[];
  messages?: IncomingMessage[];
  statuses?: MessageStatusUpdate[];
}

export interface WebhookContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: IncomingMessageType;
  text?: { body: string };
  image?: MediaContent;
  audio?: MediaContent;
  document?: MediaContent & { filename: string };
  video?: MediaContent;
  location?: LocationContent;
  contacts?: ContactContent[];
  interactive?: InteractiveReply;
  button?: ButtonReply;
  context?: MessageContext;
}

export type IncomingMessageType = 
  | 'text'
  | 'image'
  | 'audio'
  | 'document'
  | 'video'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button';

export interface MediaContent {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}

export interface LocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactContent {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: Array<{
    phone: string;
    type: string;
    wa_id?: string;
  }>;
}

export interface InteractiveReply {
  type: 'button_reply' | 'list_reply';
  button_reply?: {
    id: string;
    title: string;
  };
  list_reply?: {
    id: string;
    title: string;
    description?: string;
  };
}

export interface ButtonReply {
  payload: string;
  text: string;
}

export interface MessageContext {
  from: string;
  id: string;
}

export interface MessageStatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    expiration_timestamp?: string;
    origin: {
      type: 'business_initiated' | 'user_initiated' | 'referral_conversion';
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: WebhookError[];
}

export interface WebhookError {
  code: number;
  title: string;
  message: string;
  error_data?: {
    details: string;
  };
}

// ============================================================================
// Outgoing Message Types
// ============================================================================

export interface OutgoingTextMessage {
  to: string;
  text: string;
  previewUrl?: boolean;
}

export interface OutgoingTemplateMessage {
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'document' | 'video' | 'payload';
  text?: string;
  currency?: CurrencyParameter;
  date_time?: DateTimeParameter;
  image?: MediaParameter;
  document?: DocumentParameter;
  video?: MediaParameter;
  payload?: string;
}

export interface CurrencyParameter {
  fallback_value: string;
  code: string;
  amount_1000: number;
}

export interface DateTimeParameter {
  fallback_value: string;
}

export interface MediaParameter {
  link: string;
  caption?: string;
}

export interface DocumentParameter {
  link: string;
  filename?: string;
}

export interface OutgoingMediaMessage {
  to: string;
  type: 'image' | 'document' | 'audio' | 'video';
  mediaUrl: string;
  caption?: string;
  filename?: string;
}

export interface OutgoingInteractiveMessage {
  to: string;
  type: 'button' | 'list';
  header?: InteractiveHeader;
  body: string;
  footer?: string;
  buttons?: InteractiveButton[];
  sections?: InteractiveSection[];
  buttonText?: string;
}

export interface InteractiveHeader {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  image?: { link: string };
  document?: { link: string; filename?: string };
  video?: { link: string };
}

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveSection {
  title: string;
  rows: InteractiveRow[];
}

export interface InteractiveRow {
  id: string;
  title: string;
  description?: string;
}

export interface OutgoingLocationMessage {
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface SendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
}

export interface MediaUploadResponse {
  id: string;
}

export interface MediaDownloadResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
}

// ============================================================================
// Reminder Types
// ============================================================================

export interface ReminderSchedule {
  id: string;
  tenantId: string;
  phoneNumber: string;
  type: ReminderType;
  scheduledFor: Date;
  data: ReminderData;
  status: 'pending' | 'sent' | 'cancelled';
  createdAt: Date;
  sentAt?: Date;
}

export type ReminderType = 
  | 'rent_due_t_minus_5'
  | 'rent_due_t_minus_1'
  | 'rent_due_today'
  | 'rent_overdue_t_plus_3'
  | 'rent_overdue_t_plus_7'
  | 'maintenance_appointment'
  | 'document_expiry'
  | 'lease_renewal';

export interface ReminderData {
  tenantName: string;
  amount?: number;
  dueDate?: string;
  propertyName?: string;
  unitNumber?: string;
  maintenanceDate?: string;
  documentType?: string;
  expiryDate?: string;
  leaseEndDate?: string;
  /** Maintenance appointment reminder fields */
  appointmentDate?: string;
  appointmentTime?: string;
  technicianName?: string;
  issueType?: string;
}

// ============================================================================
// Work Order Types
// ============================================================================

export interface WorkOrderFromChat {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  issueType: string;
  description: string;
  location: string;
  severity: MaintenanceSeverity;
  photoUrls: string[];
  voiceNoteUrl?: string;
  transcription?: string;
  conversationId: string;
  status: 'pending_approval' | 'approved' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Feedback Types
// ============================================================================

export interface FeedbackFromChat {
  id: string;
  tenantId: string;
  type: 'day_3_checkin' | 'day_10_checkin' | 'post_maintenance' | 'general';
  rating: number;
  comment?: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  issues: string[];
  requiresFollowUp: boolean;
  conversationId: string;
  createdAt: Date;
}

// ============================================================================
// Emergency Types
// ============================================================================

export interface EmergencyIncident {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  type: EmergencyType;
  description: string;
  location?: string;
  reportedAt: Date;
  status: 'active' | 'responding' | 'resolved';
  escalationLevel: number;
  notifiedContacts: string[];
  timeline: EmergencyTimelineEvent[];
  resolvedAt?: Date;
  resolutionNotes?: string;
}

// ============================================================================
// NLP/Intent Types
// ============================================================================

export interface ExtractedIntent {
  intent: IntentType;
  confidence: number;
  entities: ExtractedEntity[];
  language: SupportedLanguage;
  rawText: string;
}

export type IntentType = 
  | 'greeting'
  | 'maintenance_request'
  | 'payment_inquiry'
  | 'rent_payment'
  | 'feedback'
  | 'complaint'
  | 'emergency'
  | 'document_request'
  | 'lease_inquiry'
  | 'general_question'
  | 'unknown';

export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  position: {
    start: number;
    end: number;
  };
}

export type EntityType = 
  | 'date'
  | 'time'
  | 'location'
  | 'amount'
  | 'phone'
  | 'issue_type'
  | 'severity'
  | 'person_name'
  | 'unit_number';

// ============================================================================
// Configuration Types
// ============================================================================

export interface WhatsAppBusinessConfig {
  apiUrl: string;
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  appSecret: string;
  defaultLanguage: SupportedLanguage;
  sessionTimeoutMinutes: number;
  emergencyKeywords: Record<SupportedLanguage, string[]>;
  emergencyContacts: EmergencyContact[];
}

export interface EmergencyContact {
  name: string;
  phone: string;
  role: 'security' | 'manager' | 'maintenance' | 'fire' | 'medical';
  availableHours?: {
    start: string;
    end: string;
  };
}
