/**
 * Meta WhatsApp Business API Client for BORJIE
 * Full-featured client with authentication, messaging, media, and webhooks
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { createLogger } from '../logger.js';
import type {
  WhatsAppBusinessConfig,
  OutgoingTextMessage,
  OutgoingTemplateMessage,
  OutgoingMediaMessage,
  OutgoingInteractiveMessage,
  OutgoingLocationMessage,
  SendMessageResponse,
  MediaUploadResponse,
  MediaDownloadResponse,
  WhatsAppWebhookPayload,
  IncomingMessage,
  MessageStatusUpdate,
  TemplateComponent,
  InteractiveHeader,
  InteractiveButton,
  InteractiveSection,
  SupportedLanguage,
} from './types.js';

const logger = createLogger('WhatsAppMetaClient');

// ============================================================================
// HIGH-8: Meta CDN host allowlist
// ============================================================================
//
// `META_MEDIA_ALLOWED_HOSTS` is a comma-separated list of exact hosts or
// `*.suffix` wildcards. Defaults cover Meta's documented CDN domains.
// We refuse to issue an Authorization-bearing media request to any host
// outside this list.

const DEFAULT_META_MEDIA_HOSTS: ReadonlyArray<string> = Object.freeze([
  'lookaside.fbsbx.com',
  '*.fbcdn.net',
  'graph.facebook.com',
  'media.fbsbx.com',
]);

function getAllowedMetaMediaHosts(): ReadonlyArray<string> {
  const env = process.env.META_MEDIA_ALLOWED_HOSTS?.trim();
  if (!env) return DEFAULT_META_MEDIA_HOSTS;
  return env
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

export function isAllowedMetaMediaHost(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  for (const pattern of getAllowedMetaMediaHosts()) {
    const normalised = pattern.toLowerCase();
    if (normalised.startsWith('*.')) {
      const suffix = normalised.slice(2);
      if (host.endsWith('.' + suffix) || host === suffix) return true;
    } else if (host === normalised) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Error Classes
// ============================================================================

export class WhatsAppAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: number,
    public errorSubcode?: number,
    public fbTraceId?: string
  ) {
    super(message);
    this.name = 'WhatsAppAPIError';
  }
}

export class WhatsAppRateLimitError extends WhatsAppAPIError {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message, 429);
    this.name = 'WhatsAppRateLimitError';
  }
}

/**
 * Thrown by {@link MetaWhatsAppClient.parseWebhookPayload} when the
 * incoming body cannot be parsed as a `whatsapp_business_account`
 * webhook. The router catches this BEFORE sending 200 and returns 400
 * so Meta retries (round-3 audit C3).
 */
export class WebhookPayloadParseError extends Error {
  readonly code = 'WEBHOOK_PAYLOAD_PARSE_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookPayloadParseError';
  }
}

// ============================================================================
// Region dial codes — sourced from region-config conceptually; inlined so
// the notifications service stays dependency-light. Keep in sync with
// `packages/domain-models/src/common/region-config.ts`.
// ============================================================================

const REGION_DIAL_MAP: Readonly<
  Record<string, { readonly dialingCode: string; readonly trunkPrefix?: string }>
> = {
  TZ: { dialingCode: '255', trunkPrefix: '0' },
  KE: { dialingCode: '254', trunkPrefix: '0' },
  UG: { dialingCode: '256', trunkPrefix: '0' },
  RW: { dialingCode: '250', trunkPrefix: '0' },
};

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: Partial<WhatsAppBusinessConfig> = {
  apiUrl: 'https://graph.facebook.com/v18.0',
  defaultLanguage: 'en',
  sessionTimeoutMinutes: 30,
  emergencyKeywords: {
    en: ['fire', 'flood', 'emergency', 'break-in', 'gas leak'],
    sw: ['moto', 'mafuriko', 'dharura', 'uvamizi', 'gesi'],
  },
  emergencyContacts: [],
};

// ============================================================================
// Meta WhatsApp Business API Client
// ============================================================================

export class MetaWhatsAppClient {
  private config: WhatsAppBusinessConfig;
  private client: AxiosInstance;

  constructor(config?: Partial<WhatsAppBusinessConfig>) {
    this.config = {
      apiUrl: config?.apiUrl || process.env['WHATSAPP_API_URL'] || DEFAULT_CONFIG.apiUrl!,
      accessToken: config?.accessToken || process.env['WHATSAPP_ACCESS_TOKEN'] || '',
      phoneNumberId: config?.phoneNumberId || process.env['WHATSAPP_PHONE_NUMBER_ID'] || '',
      businessAccountId: config?.businessAccountId || process.env['WHATSAPP_BUSINESS_ACCOUNT_ID'] || '',
      webhookVerifyToken: config?.webhookVerifyToken || process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] || '',
      appSecret: config?.appSecret || process.env['WHATSAPP_APP_SECRET'] || '',
      defaultLanguage: config?.defaultLanguage || DEFAULT_CONFIG.defaultLanguage!,
      sessionTimeoutMinutes: config?.sessionTimeoutMinutes || DEFAULT_CONFIG.sessionTimeoutMinutes!,
      emergencyKeywords: config?.emergencyKeywords || DEFAULT_CONFIG.emergencyKeywords!,
      emergencyContacts: config?.emergencyContacts || DEFAULT_CONFIG.emergencyContacts!,
    };

    this.client = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Retry interceptor — exponential backoff on 429 / 5xx / network errors.
    // Adds `_retryCount` to the config so we cap at 3 retries.
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError & { config?: { _retryCount?: number } }) => {
        const cfg = (error.config ?? {}) as typeof error.config & {
          _retryCount?: number;
        };
        const status = error.response?.status;
        const retryable =
          status === undefined ||
          status === 408 ||
          status === 429 ||
          (status >= 500 && status < 600);
        const max = 3;
        const attempt = (cfg._retryCount ?? 0) + 1;
        if (retryable && attempt <= max) {
          cfg._retryCount = attempt;
          const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          return this.client.request(cfg);
        }
        return this.handleAPIError(error);
      }
    );
  }

  // ============================================================================
  // Phone Number Formatting
  // ============================================================================

  /**
   * Format a phone number to WhatsApp's E.164-without-+ format.
   *
   * If `countryCode` is provided we use the region dialing map to
   * canonicalize the number. If it is not provided we trust the caller
   * passed an already-international number and strip non-digits only —
   * no country default is ever guessed. This prevents the old
   * Kenya/Tanzania/Uganda misrouting bug where local numbers were
   * silently rewritten to whichever branch matched first.
   */
  formatPhoneNumber(phone: string, countryCode?: string): string {
    const digits = phone.replace(/\D/g, '');
    if (!countryCode) return digits;
    const region = REGION_DIAL_MAP[countryCode.toUpperCase()];
    if (!region) {
      // Unknown country — preserve the caller's input rather than fabricate.
      return digits;
    }
    if (digits.startsWith(region.dialingCode)) return digits;
    if (region.trunkPrefix && digits.startsWith(region.trunkPrefix)) {
      return region.dialingCode + digits.slice(region.trunkPrefix.length);
    }
    return region.dialingCode + digits;
  }

  // ============================================================================
  // Text Messages
  // ============================================================================

  /**
   * Send a simple text message
   */
  async sendText(message: OutgoingTextMessage): Promise<SendMessageResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(message.to),
      type: 'text',
      text: {
        preview_url: message.previewUrl ?? false,
        body: message.text,
      },
    };

    logger.info('Sending text message', { to: message.to });
    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    logger.debug('Text message sent', { messageId: response.data.messages?.[0]?.id });
    
    return response.data;
  }

  /**
   * Send text message with reply context (thread)
   */
  async sendTextReply(
    to: string,
    text: string,
    replyToMessageId: string
  ): Promise<SendMessageResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'text',
      context: {
        message_id: replyToMessageId,
      },
      text: {
        body: text,
      },
    };

    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  // ============================================================================
  // Template Messages
  // ============================================================================

  /**
   * Send a pre-approved template message
   */
  async sendTemplate(message: OutgoingTemplateMessage): Promise<SendMessageResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(message.to),
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        components: message.components,
      },
    };

    logger.info('Sending template message', { 
      to: message.to, 
      template: message.templateName 
    });
    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  /**
   * Helper to create template components
   */
  createTemplateComponents(params: {
    headerParams?: Array<{ type: 'text' | 'image' | 'document'; value: string }>;
    bodyParams?: string[];
    buttonParams?: Array<{ type: 'quick_reply' | 'url'; payload?: string; text?: string }>;
  }): TemplateComponent[] {
    const components: TemplateComponent[] = [];

    if (params.headerParams && params.headerParams.length > 0) {
      components.push({
        type: 'header',
        parameters: params.headerParams.map((p) => {
          if (p.type === 'text') {
            return { type: 'text', text: p.value };
          } else if (p.type === 'image') {
            return { type: 'image', image: { link: p.value } };
          } else {
            return { type: 'document', document: { link: p.value } };
          }
        }),
      });
    }

    if (params.bodyParams && params.bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }

    if (params.buttonParams && params.buttonParams.length > 0) {
      params.buttonParams.forEach((btn, index) => {
        components.push({
          type: 'button',
          sub_type: btn.type,
          index,
          parameters: btn.payload 
            ? [{ type: 'payload', payload: btn.payload }]
            : [{ type: 'text', text: btn.text || '' }],
        });
      });
    }

    return components;
  }

  // ============================================================================
  // Media Messages
  // ============================================================================

  /**
   * Send a media message (image, document, audio, video)
   */
  async sendMedia(message: OutgoingMediaMessage): Promise<SendMessageResponse> {
    const mediaPayload: Record<string, unknown> = {
      link: message.mediaUrl,
    };

    if (message.caption) {
      mediaPayload.caption = message.caption;
    }

    if (message.type === 'document' && message.filename) {
      mediaPayload.filename = message.filename;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(message.to),
      type: message.type,
      [message.type]: mediaPayload,
    };

    logger.info('Sending media message', { to: message.to, type: message.type });
    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  /**
   * Upload media to WhatsApp servers
   */
  async uploadMedia(
    fileBuffer: Buffer,
    mimeType: string,
    filename?: string
  ): Promise<MediaUploadResponse> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    
    form.append('messaging_product', 'whatsapp');
    form.append('file', fileBuffer, {
      filename: filename || 'file',
      contentType: mimeType,
    });

    const response = await this.client.post<MediaUploadResponse>(
      `/${this.config.phoneNumberId}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      }
    );

    return response.data;
  }

  /**
   * Get media download URL
   */
  async getMediaUrl(mediaId: string): Promise<MediaDownloadResponse> {
    const response = await this.client.get<MediaDownloadResponse>(`/${mediaId}`);
    return response.data;
  }

  /**
   * Download media file
   *
   * HIGH-8 (audit .audit/post-pr90-api-mcp-bug-sweep.md): Meta returns
   * an arbitrary URL from `getMediaUrl`. If that URL is ever a non-Meta
   * host (Meta API compromise, redirect chain, future product change),
   * sending `Authorization: Bearer ${this.config.accessToken}` to it
   * leaks the Meta access token to the attacker.
   *
   * Fix: validate the host against an allowlist of Meta CDN domains
   * BEFORE issuing the request. If the host is not Meta-controlled,
   * either (a) drop the Authorization header entirely OR (b) refuse
   * the download — we choose (b), the strictest option.
   *
   * Allowlist sourced from `META_MEDIA_ALLOWED_HOSTS` (comma-separated
   * exact hosts or `*.suffix` wildcards). Defaults cover Meta's
   * documented CDN domains.
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    const mediaInfo = await this.getMediaUrl(mediaId);

    if (!isAllowedMetaMediaHost(mediaInfo.url)) {
      throw new Error(
        `downloadMedia refused: Meta returned a non-allowlisted host`
      );
    }

    const response = await axios.get(mediaInfo.url, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      responseType: 'arraybuffer',
    });

    return Buffer.from(response.data);
  }

  // ============================================================================
  // Interactive Messages
  // ============================================================================

  /**
   * Send an interactive message with buttons
   */
  async sendButtons(
    to: string,
    body: string,
    buttons: InteractiveButton[],
    options?: {
      header?: InteractiveHeader;
      footer?: string;
    }
  ): Promise<SendMessageResponse> {
    const interactive: Record<string, unknown> = {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.slice(0, 20) },
        })),
      },
    };

    if (options?.header) {
      interactive.header = this.formatInteractiveHeader(options.header);
    }

    if (options?.footer) {
      interactive.footer = { text: options.footer };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'interactive',
      interactive,
    };

    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  /**
   * Send an interactive list message
   */
  async sendList(
    to: string,
    body: string,
    sections: InteractiveSection[],
    options?: {
      header?: InteractiveHeader;
      footer?: string;
      buttonText?: string;
    }
  ): Promise<SendMessageResponse> {
    const interactive: Record<string, unknown> = {
      type: 'list',
      body: { text: body },
      action: {
        button: options?.buttonText || 'View Options',
        sections: sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title.slice(0, 24),
            description: row.description?.slice(0, 72),
          })),
        })),
      },
    };

    if (options?.header) {
      interactive.header = this.formatInteractiveHeader(options.header);
    }

    if (options?.footer) {
      interactive.footer = { text: options.footer };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(to),
      type: 'interactive',
      interactive,
    };

    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  /**
   * Send interactive message (unified method)
   */
  async sendInteractive(message: OutgoingInteractiveMessage): Promise<SendMessageResponse> {
    if (message.type === 'button' && message.buttons) {
      return this.sendButtons(message.to, message.body, message.buttons, {
        header: message.header,
        footer: message.footer,
      });
    } else if (message.type === 'list' && message.sections) {
      return this.sendList(message.to, message.body, message.sections, {
        header: message.header,
        footer: message.footer,
        buttonText: message.buttonText,
      });
    }

    throw new Error('Invalid interactive message type');
  }

  private formatInteractiveHeader(header: InteractiveHeader): Record<string, unknown> {
    const formatted: Record<string, unknown> = { type: header.type };
    
    switch (header.type) {
      case 'text':
        formatted.text = header.text;
        break;
      case 'image':
        formatted.image = header.image;
        break;
      case 'document':
        formatted.document = header.document;
        break;
      case 'video':
        formatted.video = header.video;
        break;
    }

    return formatted;
  }

  // ============================================================================
  // Location Messages
  // ============================================================================

  /**
   * Send a location message
   */
  async sendLocation(message: OutgoingLocationMessage): Promise<SendMessageResponse> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhoneNumber(message.to),
      type: 'location',
      location: {
        latitude: message.latitude,
        longitude: message.longitude,
        name: message.name,
        address: message.address,
      },
    };

    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      payload
    );
    
    return response.data;
  }

  // ============================================================================
  // Message Status
  // ============================================================================

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.client.post(`/${this.config.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });

    logger.debug('Message marked as read', { messageId });
  }

  /**
   * React to a message with an emoji
   */
  async reactToMessage(messageId: string, emoji: string): Promise<SendMessageResponse> {
    const response = await this.client.post<SendMessageResponse>(
      `/${this.config.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji,
        },
      }
    );

    return response.data;
  }

  // ============================================================================
  // Webhook Handling
  // ============================================================================

  /**
   * Verify webhook subscription (GET request)
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.config.webhookVerifyToken) {
      logger.info('Webhook verified successfully');
      return challenge;
    }
    logger.warn('Webhook verification failed', { mode, tokenMatch: token === this.config.webhookVerifyToken });
    return null;
  }

  /**
   * Validate webhook signature (X-Hub-Signature-256).
   *
   * Round-3 audit C1 + C2 fix:
   * - C1: NEVER returns `true` when `appSecret` is missing. The pre-fix
   *   behaviour silently accepted unsigned webhooks in any deployment
   *   that forgot to set `WHATSAPP_APP_SECRET`. Production must fail
   *   closed; tests can opt-out at the router level via
   *   `validateSignature: false`.
   * - C2: `crypto.timingSafeEqual` throws `RangeError` when buffers are
   *   different lengths (which an attacker controls via the
   *   `x-hub-signature-256` header). The previous code allowed that
   *   throw to propagate to the express middleware → unhandledRejection
   *   sink → handler crash. We now normalise lengths AND wrap the
   *   compare in try/catch so a malformed signature returns `false`
   *   instead of crashing.
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    if (!this.config.appSecret) {
      logger.error(
        'WHATSAPP_APP_SECRET missing — webhook rejected. ' +
          'Set the env var or pass `validateSignature: false` in dev tests.'
      );
      return false;
    }

    if (typeof signature !== 'string' || signature.length === 0) {
      logger.warn('Webhook signature missing or empty');
      return false;
    }

    const expectedSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', this.config.appSecret)
        .update(payload)
        .digest('hex');

    try {
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');

      // Length mismatch ⇒ invalid signature. timingSafeEqual would throw
      // RangeError, which previously killed the handler.
      if (sigBuf.length !== expBuf.length) {
        logger.warn('Webhook signature length mismatch', {
          received: sigBuf.length,
          expected: expBuf.length,
        });
        return false;
      }

      const valid = crypto.timingSafeEqual(sigBuf, expBuf);
      if (!valid) {
        logger.warn('Webhook signature validation failed');
      }
      return valid;
    } catch (error) {
      logger.warn('Webhook signature comparison threw', { error: String(error) });
      return false;
    }
  }

  /**
   * Parse incoming webhook payload.
   *
   * Round-3 audit C3 fix: the previous implementation wrapped the
   * traversal in a try/catch that swallowed every error and returned
   * empty arrays. Combined with the router already having sent 200 to
   * Meta, malformed-but-signed payloads silently vanished — Meta does
   * NOT retry on 2xx responses, so a real emergency notification could
   * be lost.
   *
   * The function now throws {@link WebhookPayloadParseError} on
   * malformed inputs and shapes that don't match
   * `whatsapp_business_account`. The router catches this BEFORE sending
   * 200, returns 400, and Meta retries.
   */
  parseWebhookPayload(body: unknown): {
    messages: IncomingMessage[];
    statuses: MessageStatusUpdate[];
    contacts: Array<{ wa_id: string; name: string }>;
  } {
    if (body === null || typeof body !== 'object') {
      throw new WebhookPayloadParseError('webhook body is not an object');
    }

    const data = body as WhatsAppWebhookPayload;

    if (data.object !== 'whatsapp_business_account') {
      throw new WebhookPayloadParseError(
        `unsupported webhook object: "${String(data.object)}"`
      );
    }

    const result = {
      messages: [] as IncomingMessage[],
      statuses: [] as MessageStatusUpdate[],
      contacts: [] as Array<{ wa_id: string; name: string }>,
    };

    const entries = Array.isArray(data.entry) ? data.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        if (!value || typeof value !== 'object') continue;

        if (Array.isArray(value.messages)) {
          result.messages.push(...value.messages);
        }

        if (Array.isArray(value.statuses)) {
          result.statuses.push(...value.statuses);
        }

        if (Array.isArray(value.contacts)) {
          for (const c of value.contacts) {
            if (c && typeof c === 'object' && typeof c.wa_id === 'string') {
              result.contacts.push({
                wa_id: c.wa_id,
                name: c.profile?.name ?? '',
              });
            }
          }
        }
      }
    }

    return result;
  }

  // ============================================================================
  // Business Profile
  // ============================================================================

  /**
   * Get business profile
   */
  async getBusinessProfile(): Promise<Record<string, unknown>> {
    const response = await this.client.get(
      `/${this.config.phoneNumberId}/whatsapp_business_profile`,
      {
        params: {
          fields: 'about,address,description,email,profile_picture_url,websites,vertical',
        },
      }
    );
    return response.data;
  }

  /**
   * Update business profile
   */
  async updateBusinessProfile(profile: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    vertical?: string;
    websites?: string[];
  }): Promise<void> {
    await this.client.post(`/${this.config.phoneNumberId}/whatsapp_business_profile`, {
      messaging_product: 'whatsapp',
      ...profile,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Handle API errors
   */
  private handleAPIError(error: AxiosError): never {
    const response = error.response;
    
    if (response) {
      const data = response.data as Record<string, unknown>;
      const errorObj = data?.error as Record<string, unknown> | undefined;
      
      if (response.status === 429) {
        throw new WhatsAppRateLimitError(
          errorObj?.message as string || 'Rate limit exceeded',
          response.headers['retry-after'] ? parseInt(response.headers['retry-after'] as string, 10) : undefined
        );
      }

      throw new WhatsAppAPIError(
        errorObj?.message as string || 'API request failed',
        response.status,
        errorObj?.code as number,
        errorObj?.error_subcode as number,
        errorObj?.fbtrace_id as string
      );
    }

    throw new WhatsAppAPIError(error.message || 'Network error');
  }

  /**
   * Get configuration
   */
  getConfig(): WhatsAppBusinessConfig {
    return { ...this.config };
  }

  /**
   * Update access token (for token refresh)
   */
  updateAccessToken(newToken: string): void {
    this.config.accessToken = newToken;
    this.client.defaults.headers['Authorization'] = `Bearer ${newToken}`;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const metaWhatsAppClient = new MetaWhatsAppClient();
