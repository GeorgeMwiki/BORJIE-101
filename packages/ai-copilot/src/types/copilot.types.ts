/**
 * Copilot Types for Domain-Specific AI Assistance
 * 
 * Types for:
 * - Maintenance triage copilot
 * - Owner reporting copilot
 * - Communication drafting copilot
 * - Risk alerting copilot
 */

import { z } from 'zod';
import {
  CopilotRequestId,
  CopilotDomain,
  CopilotRequestStatus,
  CopilotOutputBase,
  RiskLevel,
  ConfidenceLevel,
  AITenantContext,
  AIActor,
  HumanReview,
} from './core.types.js';

// ============================================
// MAINTENANCE TRIAGE COPILOT
// ============================================

/**
 * Urgency level for maintenance requests
 */
export const MaintenanceUrgency = {
  EMERGENCY: 'EMERGENCY', // Life safety, habitability threat
  URGENT: 'URGENT',       // Service impact, needs same-day attention
  HIGH: 'HIGH',           // Should be addressed within 24-48 hours
  MEDIUM: 'MEDIUM',       // Standard priority, within a week
  LOW: 'LOW',             // Can be scheduled conveniently
  SCHEDULED: 'SCHEDULED', // Planned maintenance
} as const;

export type MaintenanceUrgency = typeof MaintenanceUrgency[keyof typeof MaintenanceUrgency];

/**
 * Maintenance category classification — mining equipment taxonomy
 * (mirrors the central-intelligence maintenance-dispatch classifier).
 */
export const MaintenanceCategory = {
  PUMPING: 'PUMPING',
  ELECTRICAL: 'ELECTRICAL',
  HYDRAULICS: 'HYDRAULICS',
  PROCESSING: 'PROCESSING',
  VEHICLE: 'VEHICLE',
  STRUCTURAL: 'STRUCTURAL',
  SAFETY: 'SAFETY',
  GENERAL: 'GENERAL',
} as const;

export type MaintenanceCategory = typeof MaintenanceCategory[keyof typeof MaintenanceCategory];

/**
 * Input for maintenance triage request
 */
export interface MaintenanceTriageInput {
  /** Requester's original request text */
  requestText: string;
  /** Any attached images/files */
  attachments?: {
    type: 'image' | 'document' | 'video';
    url: string;
    description?: string;
  }[];
  /** Site context */
  site: {
    id: string;
    name: string;
    type: string;
    age: number;
  };
  /** Pit context */
  pit: {
    id: string;
    number: string;
    benches: number;
    faces: number;
  };
  /** Requester context */
  requester: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    preferredContactMethod?: 'phone' | 'email' | 'sms' | 'app';
  };
  /** Recent maintenance history for context */
  recentHistory?: {
    category: string;
    description: string;
    resolvedAt: string;
    daysAgo: number;
  }[];
}

/**
 * Maintenance triage copilot output
 */
export interface MaintenanceTriageOutput extends CopilotOutputBase {
  domain: typeof CopilotDomain.MAINTENANCE_TRIAGE;
  
  /** Input that was processed */
  input: MaintenanceTriageInput;
  
  /** Triage results */
  triage: {
    /** Classified urgency level */
    urgency: MaintenanceUrgency;
    /** Confidence in urgency classification */
    urgencyConfidence: number;
    /** Primary category */
    category: MaintenanceCategory;
    /** Sub-category if applicable */
    subcategory?: string;
    /** Category confidence */
    categoryConfidence: number;
    /** Key issues identified */
    issuesIdentified: string[];
    /** Potential safety concerns */
    safetyConcerns: string[];
    /** Whether site access is needed */
    requiresSiteAccess: boolean;
    /** Estimated complexity (1-5) */
    estimatedComplexity: number;
  };
  
  /** Recommended routing */
  routing: {
    /** Suggested vendor type */
    vendorType: string;
    /** Specific vendor IDs if available */
    suggestedVendorIds?: string[];
    /** Skill requirements */
    skillsRequired: string[];
    /** Estimated service time (hours) */
    estimatedServiceHours: number;
    /** Suggested scheduling window */
    suggestedScheduling: {
      earliest: string;
      latest: string;
      preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
    };
  };
  
  /** Generated work order details */
  workOrderDraft: {
    title: string;
    description: string;
    internalNotes: string;
    estimatedCost?: {
      min: number;
      max: number;
      currency: string;
    };
  };
  
  /** Requester communication */
  requesterCommunication: {
    acknowledgmentMessage: string;
    expectedResolutionMessage: string;
    instructionsForRequester?: string;
  };
  
  /** Follow-up recommendations */
  followUp: {
    inspectionRecommended: boolean;
    preventiveMaintenanceRecommended: boolean;
    relatedSystemsToCheck: string[];
  };
}

// ============================================
// OWNER REPORTING COPILOT
// ============================================

/**
 * Report type for owner communications
 */
export const OwnerReportType = {
  MONTHLY_SUMMARY: 'MONTHLY_SUMMARY',
  QUARTERLY_REVIEW: 'QUARTERLY_REVIEW',
  ANNUAL_REPORT: 'ANNUAL_REPORT',
  MAINTENANCE_UPDATE: 'MAINTENANCE_UPDATE',
  FINANCIAL_ALERT: 'FINANCIAL_ALERT',
  PRODUCTION_UPDATE: 'PRODUCTION_UPDATE',
  MARKET_ANALYSIS: 'MARKET_ANALYSIS',
  CUSTOM: 'CUSTOM',
} as const;

export type OwnerReportType = typeof OwnerReportType[keyof typeof OwnerReportType];

/**
 * Input for owner reporting copilot
 */
export interface OwnerReportingInput {
  /** Report type requested */
  reportType: OwnerReportType;
  /** Period covered */
  period: {
    start: string;
    end: string;
  };
  /** Owner context */
  owner: {
    id: string;
    name: string;
    email: string;
    preferredTone?: 'formal' | 'professional' | 'casual';
    reportingPreferences?: {
      includeMarketComparisons: boolean;
      includePredictions: boolean;
      detailLevel: 'summary' | 'detailed' | 'comprehensive';
    };
  };
  /** Portfolio data */
  portfolio: {
    siteCount: number;
    totalPits: number;
    sites: {
      id: string;
      name: string;
      pits: number;
      productionRate: number;
      monthlyRevenue: number;
    }[];
  };
  /** Financial data */
  financials: {
    totalRevenue: number;
    totalExpenses: number;
    netOperatingIncome: number;
    collectionRate: number;
    previousPeriodComparison?: {
      revenueChange: number;
      expenseChange: number;
      noiChange: number;
    };
  };
  /** Key events to highlight */
  keyEvents?: {
    type: 'onboarding' | 'offboarding' | 'renewal' | 'maintenance' | 'payment' | 'other';
    description: string;
    date: string;
    financialImpact?: number;
  }[];
  /** Additional context or notes */
  additionalContext?: string;
}

/**
 * Owner reporting copilot output
 */
export interface OwnerReportingOutput extends CopilotOutputBase {
  domain: typeof CopilotDomain.OWNER_REPORTING;
  
  input: OwnerReportingInput;
  
  /** Generated report */
  report: {
    /** Executive summary */
    executiveSummary: string;
    /** Key metrics section */
    keyMetrics: {
      metric: string;
      value: string | number;
      trend: 'up' | 'down' | 'stable';
      trendPercent?: number;
      context?: string;
    }[];
    /** Performance highlights */
    highlights: string[];
    /** Areas needing attention */
    attentionAreas: string[];
    /** Recommendations */
    recommendations: string[];
    /** Market comparison if requested */
    marketComparison?: {
      metric: string;
      portfolioValue: number;
      marketAverage: number;
      percentile: number;
    }[];
    /** Outlook/predictions if requested */
    outlook?: {
      metric: string;
      prediction: string;
      confidence: ConfidenceLevel;
    }[];
  };
  
  /** Email-ready format */
  emailVersion: {
    subject: string;
    htmlBody: string;
    plainTextBody: string;
  };
  
  /** PDF-ready sections */
  pdfSections: {
    title: string;
    content: string;
    charts?: {
      type: 'bar' | 'line' | 'pie' | 'table';
      title: string;
      data: Record<string, unknown>;
    }[];
  }[];
}

// ============================================
// COMMUNICATION DRAFTING COPILOT
// ============================================

/**
 * Communication type
 */
export const CommunicationType = {
  OFFTAKE_RENEWAL: 'OFFTAKE_RENEWAL',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  LATE_PAYMENT: 'LATE_PAYMENT',
  MAINTENANCE_UPDATE: 'MAINTENANCE_UPDATE',
  POLICY_NOTICE: 'POLICY_NOTICE',
  WELCOME_MESSAGE: 'WELCOME_MESSAGE',
  OFFBOARDING_INFO: 'OFFBOARDING_INFO',
  GENERAL_NOTICE: 'GENERAL_NOTICE',
  EMERGENCY_ALERT: 'EMERGENCY_ALERT',
  APPRECIATION: 'APPRECIATION',
  DISPUTE_RESPONSE: 'DISPUTE_RESPONSE',
  CUSTOM: 'CUSTOM',
} as const;

export type CommunicationType = typeof CommunicationType[keyof typeof CommunicationType];

/**
 * Communication channel
 */
export const CommunicationChannel = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
  LETTER: 'LETTER',
  PUSH_NOTIFICATION: 'PUSH_NOTIFICATION',
} as const;

export type CommunicationChannel = typeof CommunicationChannel[keyof typeof CommunicationChannel];

/**
 * Input for communication drafting
 */
export interface CommunicationDraftingInput {
  /** Type of communication */
  communicationType: CommunicationType;
  /** Target channel */
  channel: CommunicationChannel;
  /** Recipient info */
  recipient: {
    type: 'buyer' | 'owner' | 'vendor' | 'prospect';
    id: string;
    name: string;
    email?: string;
    phone?: string;
    preferredLanguage?: string;
    communicationHistory?: {
      recentTopics: string[];
      sentiment: 'positive' | 'neutral' | 'negative';
      responseRate: number;
    };
  };
  /** Context for the communication */
  context: {
    site?: { id: string; name: string; location: string };
    pit?: { id: string; number: string };
    offtake?: { id: string; startDate: string; endDate: string; paymentAmount: number };
    relatedMaintenance?: { id: string; description: string; status: string };
    financialContext?: {
      amountDue?: number;
      daysOverdue?: number;
      paymentHistory?: string;
    };
  };
  /** Desired tone */
  tone: 'formal' | 'professional' | 'friendly' | 'urgent' | 'empathetic';
  /** Key points to include */
  keyPoints: string[];
  /** Things to avoid mentioning */
  avoidMentioning?: string[];
  /** Call to action */
  callToAction?: string;
  /** Deadline if applicable */
  deadline?: string;
  /** Custom instructions */
  customInstructions?: string;
}

/**
 * Communication drafting copilot output
 */
export interface CommunicationDraftingOutput extends CopilotOutputBase {
  domain: typeof CopilotDomain.COMMUNICATION_DRAFTING;
  
  input: CommunicationDraftingInput;
  
  /** Generated draft */
  draft: {
    /** Subject line (for email) */
    subject?: string;
    /** Greeting */
    greeting: string;
    /** Main body */
    body: string;
    /** Closing */
    closing: string;
    /** Signature placeholder */
    signaturePlaceholder: string;
    /** Full combined message */
    fullMessage: string;
    /** Character count */
    characterCount: number;
    /** Word count */
    wordCount: number;
  };
  
  /** Channel-specific versions */
  channelVersions: {
    email?: {
      subject: string;
      htmlBody: string;
      plainTextBody: string;
    };
    sms?: {
      message: string;
      withinCharacterLimit: boolean;
    };
    inApp?: {
      title: string;
      body: string;
      actionButton?: { label: string; url: string };
    };
    pushNotification?: {
      title: string;
      body: string;
    };
  };
  
  /** Compliance check */
  complianceCheck: {
    passed: boolean;
    issues: string[];
    suggestions: string[];
    requiredDisclosures?: string[];
  };
  
  /** Sentiment analysis */
  sentimentAnalysis: {
    overall: 'positive' | 'neutral' | 'negative';
    score: number;
    emotionalTone: string[];
  };
  
  /** Alternative versions */
  alternatives?: {
    description: string;
    draft: string;
  }[];
}

// ============================================
// RISK ALERTING COPILOT
// ============================================

/**
 * Risk alert category
 */
export const RiskAlertCategory = {
  FINANCIAL: 'FINANCIAL',
  OPERATIONAL: 'OPERATIONAL',
  COMPLIANCE: 'COMPLIANCE',
  SAFETY: 'SAFETY',
  COUNTERPARTY: 'COUNTERPARTY',
  SITE: 'SITE',
  MARKET: 'MARKET',
  FRAUD: 'FRAUD',
} as const;

export type RiskAlertCategory = typeof RiskAlertCategory[keyof typeof RiskAlertCategory];

/**
 * Input for risk alert generation
 */
export interface RiskAlertInput {
  /** Alert category */
  category: RiskAlertCategory;
  /** Risk indicators detected */
  indicators: {
    name: string;
    value: unknown;
    threshold?: unknown;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }[];
  /** Affected entities */
  affectedEntities: {
    type: 'counterparty' | 'site' | 'pit' | 'owner' | 'portfolio';
    id: string;
    name: string;
    additionalInfo?: Record<string, unknown>;
  }[];
  /** Historical context */
  historicalContext?: {
    previousOccurrences: number;
    lastOccurrence?: string;
    trend: 'improving' | 'stable' | 'worsening';
    previousActions?: string[];
  };
  /** Related data points */
  relatedData?: Record<string, unknown>;
}

/**
 * Risk alerting copilot output
 */
export interface RiskAlertOutput extends CopilotOutputBase {
  domain: typeof CopilotDomain.RISK_ALERTING;
  
  input: RiskAlertInput;
  
  /** Alert details */
  alert: {
    /** Alert title */
    title: string;
    /** Detailed description */
    description: string;
    /** Severity assessment */
    severity: 'low' | 'medium' | 'high' | 'critical';
    /** Urgency for response */
    urgency: 'informational' | 'monitor' | 'action-required' | 'immediate';
    /** Category-specific risk score (0-100) */
    riskScore: number;
    /** Potential impact description */
    potentialImpact: string;
    /** Estimated financial exposure */
    financialExposure?: {
      min: number;
      max: number;
      likely: number;
      currency: string;
    };
  };
  
  /** Root cause analysis */
  rootCauseAnalysis: {
    primaryCauses: string[];
    contributingFactors: string[];
    uncertainties: string[];
  };
  
  /** Recommended actions */
  recommendedActions: {
    immediate: {
      action: string;
      owner: string;
      deadline?: string;
      automationAvailable: boolean;
    }[];
    shortTerm: {
      action: string;
      owner: string;
      timeframe: string;
    }[];
    preventive: {
      action: string;
      benefit: string;
    }[];
  };
  
  /** Monitoring recommendations */
  monitoring: {
    metricsToWatch: string[];
    escalationTriggers: string[];
    reviewFrequency: string;
  };
  
  /** Notification configuration */
  notifications: {
    recipients: {
      role: string;
      channel: CommunicationChannel;
      message: string;
    }[];
    escalationPath: {
      level: number;
      role: string;
      triggerCondition: string;
    }[];
  };
}

/**
 * Zod schemas for copilot inputs
 */
export const MaintenanceUrgencySchema = z.enum([
  'EMERGENCY',
  'URGENT',
  'HIGH',
  'MEDIUM',
  'LOW',
  'SCHEDULED',
]);

export const MaintenanceCategorySchema = z.enum([
  'PUMPING',
  'ELECTRICAL',
  'HYDRAULICS',
  'PROCESSING',
  'VEHICLE',
  'STRUCTURAL',
  'SAFETY',
  'GENERAL',
]);

export const CommunicationTypeSchema = z.enum([
  'OFFTAKE_RENEWAL',
  'PAYMENT_REMINDER',
  'LATE_PAYMENT',
  'MAINTENANCE_UPDATE',
  'POLICY_NOTICE',
  'WELCOME_MESSAGE',
  'OFFBOARDING_INFO',
  'GENERAL_NOTICE',
  'EMERGENCY_ALERT',
  'APPRECIATION',
  'DISPUTE_RESPONSE',
  'CUSTOM',
]);

export const CommunicationChannelSchema = z.enum([
  'EMAIL',
  'SMS',
  'IN_APP',
  'LETTER',
  'PUSH_NOTIFICATION',
]);

export const RiskAlertCategorySchema = z.enum([
  'FINANCIAL',
  'OPERATIONAL',
  'COMPLIANCE',
  'SAFETY',
  'COUNTERPARTY',
  'SITE',
  'MARKET',
  'FRAUD',
]);

export const MaintenanceTriageInputSchema = z.object({
  requestText: z.string().min(1),
  attachments: z.array(z.object({
    type: z.enum(['image', 'document', 'video']),
    url: z.string().url(),
    description: z.string().optional(),
  })).optional(),
  site: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    age: z.number().min(0),
  }),
  pit: z.object({
    id: z.string(),
    number: z.string(),
    benches: z.number().min(0),
    faces: z.number().min(0),
  }),
  requester: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    preferredContactMethod: z.enum(['phone', 'email', 'sms', 'app']).optional(),
  }),
  recentHistory: z.array(z.object({
    category: z.string(),
    description: z.string(),
    resolvedAt: z.string(),
    daysAgo: z.number(),
  })).optional(),
});

export const CommunicationDraftingInputSchema = z.object({
  communicationType: CommunicationTypeSchema,
  channel: CommunicationChannelSchema,
  recipient: z.object({
    type: z.enum(['buyer', 'owner', 'vendor', 'prospect']),
    id: z.string(),
    name: z.string(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    preferredLanguage: z.string().optional(),
    communicationHistory: z.object({
      recentTopics: z.array(z.string()),
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      responseRate: z.number().min(0).max(1),
    }).optional(),
  }),
  context: z.object({
    site: z.object({
      id: z.string(),
      name: z.string(),
      location: z.string(),
    }).optional(),
    pit: z.object({
      id: z.string(),
      number: z.string(),
    }).optional(),
    offtake: z.object({
      id: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      paymentAmount: z.number(),
    }).optional(),
    relatedMaintenance: z.object({
      id: z.string(),
      description: z.string(),
      status: z.string(),
    }).optional(),
    financialContext: z.object({
      amountDue: z.number().optional(),
      daysOverdue: z.number().optional(),
      paymentHistory: z.string().optional(),
    }).optional(),
  }),
  tone: z.enum(['formal', 'professional', 'friendly', 'urgent', 'empathetic']),
  keyPoints: z.array(z.string()),
  avoidMentioning: z.array(z.string()).optional(),
  callToAction: z.string().optional(),
  deadline: z.string().optional(),
  customInstructions: z.string().optional(),
});
