/**
 * Sentiment Analyzer Service
 * AI-powered sentiment analysis for customer communications
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { SENTIMENT_ANALYSIS_PROMPT } from '../prompts/index.js';

export const SentimentLevel = {
  VERY_POSITIVE: 'VERY_POSITIVE',
  POSITIVE: 'POSITIVE',
  NEUTRAL: 'NEUTRAL',
  NEGATIVE: 'NEGATIVE',
  VERY_NEGATIVE: 'VERY_NEGATIVE',
} as const;

export type SentimentLevel = (typeof SentimentLevel)[keyof typeof SentimentLevel];

export const EmotionType = {
  JOY: 'JOY',
  SATISFACTION: 'SATISFACTION',
  GRATITUDE: 'GRATITUDE',
  TRUST: 'TRUST',
  ANTICIPATION: 'ANTICIPATION',
  NEUTRAL: 'NEUTRAL',
  CONCERN: 'CONCERN',
  FRUSTRATION: 'FRUSTRATION',
  ANGER: 'ANGER',
  DISAPPOINTMENT: 'DISAPPOINTMENT',
  ANXIETY: 'ANXIETY',
  SADNESS: 'SADNESS',
  CONFUSION: 'CONFUSION',
  URGENCY: 'URGENCY',
} as const;

export type EmotionType = (typeof EmotionType)[keyof typeof EmotionType];

export interface MessageContext {
  source?: 'email' | 'sms' | 'chat' | 'call_transcript' | 'review' | 'survey';
  previousMessages?: Array<{ role: 'customer' | 'agent'; content: string; timestamp?: string }>;
  customerInfo?: { tenureDays?: number; segment?: string; recentIssues?: string[] };
}

export interface DetectedEmotion {
  emotion: EmotionType;
  intensity: number;
  triggers?: string[];
  quotes?: string[];
}

export interface ResponseRecommendation {
  approach: string;
  tone: string;
  keyPoints: string[];
  thingsToAvoid: string[];
  suggestedPhrases: string[];
  escalationRecommended: boolean;
  escalationReason?: string;
}

export interface SentimentAnalysisResult {
  score: number;
  level: SentimentLevel;
  confidence: number;
  emotion: EmotionType;
  emotions: DetectedEmotion[];
  intents: Array<{ intent: string; confidence: number; urgency: 'low' | 'medium' | 'high' | 'critical'; actionRequired: boolean }>;
  keyPhrases: { positive: string[]; negative: string[]; neutral: string[] };
  linguisticAnalysis: {
    formality: 'formal' | 'neutral' | 'informal';
    clarity: 'clear' | 'somewhat_clear' | 'unclear';
    politeness: 'polite' | 'neutral' | 'impolite';
    assertiveness: 'assertive' | 'neutral' | 'passive';
  };
  urgencyIndicators: { level: 'low' | 'medium' | 'high' | 'critical'; signals: string[] };
  responseRecommendation: ResponseRecommendation;
  riskFlags: { escalationRisk: boolean; churnRisk: boolean; legalRisk: boolean; reputationRisk: boolean; details?: string[] };
  summary: string;
}

const emotionValues = ['JOY', 'SATISFACTION', 'GRATITUDE', 'TRUST', 'ANTICIPATION', 'NEUTRAL',
  'CONCERN', 'FRUSTRATION', 'ANGER', 'DISAPPOINTMENT', 'ANXIETY', 'SADNESS', 'CONFUSION', 'URGENCY'] as const;

const SentimentAnalysisResultSchema = z.object({
  score: z.number().min(-1).max(1),
  level: z.enum(['VERY_POSITIVE', 'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'VERY_NEGATIVE']),
  confidence: z.number().min(0).max(1),
  emotion: z.enum(emotionValues),
  emotions: z.array(z.object({
    emotion: z.enum(emotionValues),
    intensity: z.number().min(0).max(1),
    triggers: z.array(z.string()).optional(),
    quotes: z.array(z.string()).optional(),
  })),
  intents: z.array(z.object({
    intent: z.string(),
    confidence: z.number().min(0).max(1),
    urgency: z.enum(['low', 'medium', 'high', 'critical']),
    actionRequired: z.boolean(),
  })),
  keyPhrases: z.object({
    positive: z.array(z.string()),
    negative: z.array(z.string()),
    neutral: z.array(z.string()),
  }),
  linguisticAnalysis: z.object({
    formality: z.enum(['formal', 'neutral', 'informal']),
    clarity: z.enum(['clear', 'somewhat_clear', 'unclear']),
    politeness: z.enum(['polite', 'neutral', 'impolite']),
    assertiveness: z.enum(['assertive', 'neutral', 'passive']),
  }),
  urgencyIndicators: z.object({
    level: z.enum(['low', 'medium', 'high', 'critical']),
    signals: z.array(z.string()),
  }),
  responseRecommendation: z.object({
    approach: z.string(),
    tone: z.string(),
    keyPoints: z.array(z.string()),
    thingsToAvoid: z.array(z.string()),
    suggestedPhrases: z.array(z.string()),
    escalationRecommended: z.boolean(),
    escalationReason: z.string().optional(),
  }),
  riskFlags: z.object({
    escalationRisk: z.boolean(),
    churnRisk: z.boolean(),
    legalRisk: z.boolean(),
    reputationRisk: z.boolean(),
    details: z.array(z.string()).optional(),
  }),
  summary: z.string(),
});

export interface SentimentAnalyzerConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class SentimentAnalyzerService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: SentimentAnalyzerConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 1536;
  }

  async analyzeSentiment(message: string, context?: MessageContext): Promise<SentimentAnalysisResult> {
    const contextString = context ? `\n\nContext:\n${JSON.stringify(context, null, 2)}` : '';

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SENTIMENT_ANALYSIS_PROMPT.system },
        { role: 'user', content: `${SENTIMENT_ANALYSIS_PROMPT.user}\n\nMessage to analyze:\n"${message}"${contextString}` },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return SentimentAnalysisResultSchema.parse(JSON.parse(content)) as SentimentAnalysisResult;
  }
}

export function createSentimentAnalyzerService(config: SentimentAnalyzerConfig): SentimentAnalyzerService {
  return new SentimentAnalyzerService(config);
}

export async function analyzeSentiment(
  message: string,
  context?: MessageContext,
  config?: Partial<SentimentAnalyzerConfig>
): Promise<SentimentAnalysisResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  const service = createSentimentAnalyzerService({ openaiApiKey: apiKey, ...config });
  return service.analyzeSentiment(message, context);
}
