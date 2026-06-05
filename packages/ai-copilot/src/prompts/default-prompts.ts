/**
 * Default Governed Prompts
 *
 * Pre-configured prompts for Borjie AI copilots.
 * These serve as starting templates that can be customized per tenant.
 */

import { CopilotDomain, RiskLevel } from '../types/core.types.js';
import { PromptCategory, CreatePromptRequest } from '../types/prompt.types.js';

/**
 * Maintenance Triage System Prompt
 */
export const MAINTENANCE_TRIAGE_SYSTEM_PROMPT = `You are an expert mining equipment-maintenance triage assistant for the Borjie mining estate operating system.

Your role is to:
1. Analyze maintenance requests from site crews
2. Classify urgency and category accurately
3. Identify safety concerns immediately
4. Recommend appropriate routing and scheduling
5. Generate professional work order details
6. Draft crew-friendly communications

URGENCY LEVELS (use exactly these values):
- EMERGENCY: Life-safety issues, pit flooding, gas/methane alarms, electrical fires, ground subsidence
- URGENT: Major production disruption, dewatering pump failure, ventilation fan down, switchgear arcing
- HIGH: Significant impact, hydraulic hose burst, crusher jam, haul-truck breakdown affecting daily output
- MEDIUM: Standard maintenance, minor leaks, conveyor wear affecting throughput
- LOW: Minor cosmetic issues, non-urgent repairs, improvement requests
- SCHEDULED: Planned maintenance, inspections, seasonal work

CATEGORIES (use exactly these values):
PUMPING, ELECTRICAL, HYDRAULICS, PROCESSING, VEHICLE, STRUCTURAL, SAFETY, GENERAL

Always prioritize crew safety and asset protection.
Be specific in work order descriptions for vendor clarity.
Consider site age and maintenance history in your assessment.`;

/**
 * Maintenance Triage Task Prompt
 */
export const MAINTENANCE_TRIAGE_PROMPT: CreatePromptRequest = {
  name: 'maintenance-triage-standard',
  description: 'Standard maintenance request triage and work order generation',
  domain: CopilotDomain.MAINTENANCE_TRIAGE,
  category: PromptCategory.TASK,
  riskLevel: RiskLevel.MEDIUM,
  systemPrompt: MAINTENANCE_TRIAGE_SYSTEM_PROMPT,
  template: `Analyze the following maintenance request and provide a structured triage assessment.

## Maintenance Request
**Site:** {{siteName}} ({{siteType}}, {{siteAge}} years old)
**Pit:** {{pitNumber}} ({{benches}} benches, {{faces}} faces)
**Requester:** {{requesterName}}
**Preferred Contact:** {{preferredContact}}

**Request:**
{{requestText}}

{{#if recentHistory}}
## Recent Maintenance History
{{#each recentHistory}}
- {{daysAgo}} days ago: {{category}} - {{description}}
{{/each}}
{{/if}}

## Required Output (JSON format)
Provide your analysis in the following JSON structure:
{
  "triage": {
    "urgency": "EMERGENCY|URGENT|HIGH|MEDIUM|LOW|SCHEDULED",
    "urgencyConfidence": 0.0-1.0,
    "category": "PUMPING|ELECTRICAL|HYDRAULICS|PROCESSING|VEHICLE|STRUCTURAL|SAFETY|GENERAL",
    "subcategory": "optional specific subcategory",
    "categoryConfidence": 0.0-1.0,
    "issuesIdentified": ["issue1", "issue2"],
    "safetyConcerns": ["concern1 if any"],
    "requiresSiteAccess": true|false,
    "estimatedComplexity": 1-5
  },
  "routing": {
    "vendorType": "pump-tech|electrician|hydraulics-tech|process-fitter|diesel-mechanic|...",
    "skillsRequired": ["skill1", "skill2"],
    "estimatedServiceHours": 0.5-8,
    "suggestedScheduling": {
      "earliest": "ISO datetime",
      "latest": "ISO datetime",
      "preferredTimeOfDay": "morning|afternoon|evening|any"
    }
  },
  "workOrderDraft": {
    "title": "concise work order title",
    "description": "detailed description for vendor",
    "internalNotes": "notes for site manager",
    "estimatedCost": { "min": 0, "max": 0, "currency": "<ISO-4217, e.g. TZS/KES/UGX>" }
  },
  "requesterCommunication": {
    "acknowledgmentMessage": "immediate response to requester",
    "expectedResolutionMessage": "timeline and next steps",
    "instructionsForRequester": "any prep needed"
  },
  "followUp": {
    "inspectionRecommended": true|false,
    "preventiveMaintenanceRecommended": true|false,
    "relatedSystemsToCheck": ["system1", "system2"]
  }
}`,
  variables: [
    { name: 'siteName', type: 'string', description: 'Site name', required: true },
    { name: 'siteType', type: 'string', description: 'Site type (open-pit, underground, alluvial, etc)', required: true },
    { name: 'siteAge', type: 'number', description: 'Site age in years', required: true },
    { name: 'pitNumber', type: 'string', description: 'Pit identifier', required: true },
    { name: 'benches', type: 'number', description: 'Number of benches', required: true },
    { name: 'faces', type: 'number', description: 'Number of active faces', required: true },
    { name: 'requesterName', type: 'string', description: 'Requester name', required: true },
    { name: 'preferredContact', type: 'string', description: 'Preferred contact method', required: false, defaultValue: 'app' },
    { name: 'requestText', type: 'string', description: 'Original request from requester', required: true },
    { name: 'recentHistory', type: 'array', description: 'Recent maintenance history', required: false },
  ],
  modelConstraints: {
    minCapabilityTier: 'standard',
    maxResponseTokens: 2048,
    temperature: 0.3,
  },
  guardrails: {
    maxInputLength: 10000,
    sanitizeInput: true,
    piiHandling: 'allow',
  },
  testCases: [
    {
      name: 'emergency-methane-alarm',
      description: 'Should identify methane alarm as emergency',
      inputs: {
        siteName: 'Geita North Pit',
        siteType: 'open-pit',
        siteAge: 15,
        pitNumber: 'P-4B',
        benches: 6,
        faces: 2,
        requesterName: 'John Kamau',
        requestText: 'The methane alarm in the lower decline is going off. It started about 30 minutes ago.',
      },
      expectedOutputContains: ['EMERGENCY', 'methane', 'safety'],
      expectedConfidenceMin: 0.9,
    },
  ],
  tags: ['maintenance', 'triage', 'core'],
};

/**
 * Owner Reporting System Prompt
 */
export const OWNER_REPORTING_SYSTEM_PROMPT = `You are a professional mining estate reporting assistant for Borjie.

Your role is to:
1. Analyze portfolio performance data
2. Generate clear, investor-grade reports
3. Highlight key achievements and concerns
4. Provide actionable recommendations
5. Compare performance against market benchmarks
6. Present data in an accessible, professional manner

Report Principles:
- Lead with key metrics and executive summary
- Use clear language avoiding jargon
- Be transparent about challenges
- Provide context for all numbers
- Include forward-looking insights where appropriate
- Maintain professional but approachable tone

Financial Accuracy:
- All monetary values should be clearly labeled with currency
- Percentages should be calculated correctly
- Comparisons should use appropriate baselines
- Trends should be based on actual data`;

/**
 * Owner Reporting Task Prompt
 */
export const OWNER_REPORTING_PROMPT: CreatePromptRequest = {
  name: 'owner-monthly-report',
  description: 'Generate monthly portfolio performance report for owners',
  domain: CopilotDomain.OWNER_REPORTING,
  category: PromptCategory.TASK,
  riskLevel: RiskLevel.MEDIUM,
  systemPrompt: OWNER_REPORTING_SYSTEM_PROMPT,
  template: `Generate a professional monthly mining estate report.

## Report Details
**Owner:** {{ownerName}}
**Report Type:** {{reportType}}
**Period:** {{periodStart}} to {{periodEnd}}
**Tone:** {{tone}}
**Detail Level:** {{detailLevel}}

## Portfolio Overview
**Total Sites:** {{siteCount}}
**Total Pits:** {{totalPits}}

### Sites
{{#each sites}}
- **{{name}}**: {{pits}} pits, {{productionRate}}% production, {{monthlyRevenue}} revenue
{{/each}}

## Financial Summary
- **Total Revenue:** {{totalRevenue}}
- **Total Expenses:** {{totalExpenses}}
- **Net Operating Income:** {{netOperatingIncome}}
- **Collection Rate:** {{collectionRate}}%

{{#if previousPeriodComparison}}
### vs Previous Period
- Revenue Change: {{previousPeriodComparison.revenueChange}}%
- Expense Change: {{previousPeriodComparison.expenseChange}}%
- NOI Change: {{previousPeriodComparison.noiChange}}%
{{/if}}

{{#if keyEvents}}
## Key Events This Period
{{#each keyEvents}}
- {{date}}: {{type}} - {{description}}{{#if financialImpact}} (Impact: {{financialImpact}}){{/if}}
{{/each}}
{{/if}}

{{#if additionalContext}}
## Additional Notes
{{additionalContext}}
{{/if}}

## Required Output (JSON format)
{
  "report": {
    "executiveSummary": "2-3 paragraph executive summary",
    "keyMetrics": [
      { "metric": "name", "value": "value", "trend": "up|down|stable", "trendPercent": 0, "context": "explanation" }
    ],
    "highlights": ["achievement1", "achievement2"],
    "attentionAreas": ["concern1", "concern2"],
    "recommendations": ["recommendation1", "recommendation2"]
  },
  "emailVersion": {
    "subject": "email subject line",
    "htmlBody": "formatted HTML email body",
    "plainTextBody": "plain text version"
  }
}`,
  variables: [
    { name: 'ownerName', type: 'string', description: 'Property owner name', required: true },
    { name: 'reportType', type: 'string', description: 'Type of report', required: true },
    { name: 'periodStart', type: 'string', description: 'Report period start date', required: true },
    { name: 'periodEnd', type: 'string', description: 'Report period end date', required: true },
    { name: 'tone', type: 'string', description: 'Desired tone', required: false, defaultValue: 'professional' },
    { name: 'detailLevel', type: 'string', description: 'Level of detail', required: false, defaultValue: 'detailed' },
    { name: 'siteCount', type: 'number', description: 'Total sites', required: true },
    { name: 'totalPits', type: 'number', description: 'Total pits', required: true },
    { name: 'sites', type: 'array', description: 'Site details', required: true },
    { name: 'totalRevenue', type: 'string', description: 'Total revenue', required: true },
    { name: 'totalExpenses', type: 'string', description: 'Total expenses', required: true },
    { name: 'netOperatingIncome', type: 'string', description: 'NOI', required: true },
    { name: 'collectionRate', type: 'number', description: 'Collection rate percentage', required: true },
    { name: 'previousPeriodComparison', type: 'object', description: 'Previous period comparison', required: false },
    { name: 'keyEvents', type: 'array', description: 'Key events during period', required: false },
    { name: 'additionalContext', type: 'string', description: 'Additional notes', required: false },
  ],
  modelConstraints: {
    minCapabilityTier: 'standard',
    maxResponseTokens: 4096,
    temperature: 0.5,
  },
  guardrails: {
    maxInputLength: 20000,
    sanitizeInput: true,
    piiHandling: 'redact',
  },
  tags: ['reporting', 'owner', 'financial', 'core'],
};

/**
 * Communication Drafting System Prompt
 */
export const COMMUNICATION_DRAFTING_SYSTEM_PROMPT = `You are a professional communication specialist for the Borjie mining estate operating system.

Your role is to:
1. Draft clear, professional communications
2. Match the requested tone and context
3. Ensure compliance with mining and trade regulations
4. Be culturally appropriate for the East African market
5. Include all necessary information without being verbose
6. Create versions optimized for different channels

Communication Principles:
- Be clear and direct
- Show empathy where appropriate
- Include specific details and next steps
- Use plain language, avoid jargon
- Respect the recipient's time
- Ensure legal compliance

Tone Guidelines:
- Formal: Official communications, legal notices
- Professional: Standard business communications
- Friendly: Welcome messages, appreciation
- Urgent: Time-sensitive matters
- Empathetic: Sensitive situations, hardship

Always maintain BORJIE's reputation for professionalism and care.`;

/**
 * Communication Drafting Task Prompt
 */
export const COMMUNICATION_DRAFTING_PROMPT: CreatePromptRequest = {
  name: 'communication-draft-standard',
  description: 'Draft professional communications for various purposes',
  domain: CopilotDomain.COMMUNICATION_DRAFTING,
  category: PromptCategory.TASK,
  riskLevel: RiskLevel.MEDIUM,
  systemPrompt: COMMUNICATION_DRAFTING_SYSTEM_PROMPT,
  template: `Draft a professional communication based on the following details.

## Communication Details
**Type:** {{communicationType}}
**Channel:** {{channel}}
**Tone:** {{tone}}

## Recipient
**Type:** {{recipientType}}
**Name:** {{recipientName}}
{{#if recipientEmail}}**Email:** {{recipientEmail}}{{/if}}
{{#if preferredLanguage}}**Language:** {{preferredLanguage}}{{/if}}

{{#if communicationHistory}}
**Recent Communication Sentiment:** {{communicationHistory.sentiment}}
**Response Rate:** {{communicationHistory.responseRate}}
{{/if}}

## Context
{{#if site}}**Site:** {{site.name}}, {{site.location}}{{/if}}
{{#if pit}}**Pit:** {{pit.number}}{{/if}}
{{#if offtake}}**Offtake:** {{offtake.startDate}} to {{offtake.endDate}}, Payment: {{offtake.paymentAmount}}{{/if}}
{{#if financialContext}}
{{#if financialContext.amountDue}}**Amount Due:** {{financialContext.amountDue}}{{/if}}
{{#if financialContext.daysOverdue}}**Days Overdue:** {{financialContext.daysOverdue}}{{/if}}
{{/if}}

## Key Points to Include
{{#each keyPoints}}
- {{this}}
{{/each}}

{{#if avoidMentioning}}
## Do NOT Mention
{{#each avoidMentioning}}
- {{this}}
{{/each}}
{{/if}}

{{#if callToAction}}**Call to Action:** {{callToAction}}{{/if}}
{{#if deadline}}**Deadline:** {{deadline}}{{/if}}

{{#if customInstructions}}
## Additional Instructions
{{customInstructions}}
{{/if}}

## Required Output (JSON format)
{
  "draft": {
    "subject": "for email only",
    "greeting": "appropriate greeting",
    "body": "main message body",
    "closing": "appropriate closing",
    "signaturePlaceholder": "[Site Manager Name]\\n[Borjie]",
    "fullMessage": "complete combined message",
    "characterCount": 0,
    "wordCount": 0
  },
  "channelVersions": {
    "email": { "subject": "", "htmlBody": "", "plainTextBody": "" },
    "sms": { "message": "", "withinCharacterLimit": true },
    "inApp": { "title": "", "body": "", "actionButton": { "label": "", "url": "" } }
  },
  "complianceCheck": {
    "passed": true,
    "issues": [],
    "suggestions": [],
    "requiredDisclosures": []
  },
  "sentimentAnalysis": {
    "overall": "positive|neutral|negative",
    "score": 0.0-1.0,
    "emotionalTone": ["professional", "empathetic"]
  }
}`,
  variables: [
    { name: 'communicationType', type: 'string', description: 'Type of communication', required: true },
    { name: 'channel', type: 'string', description: 'Target channel', required: true },
    { name: 'tone', type: 'string', description: 'Desired tone', required: true },
    { name: 'recipientType', type: 'string', description: 'Recipient type', required: true },
    { name: 'recipientName', type: 'string', description: 'Recipient name', required: true },
    { name: 'recipientEmail', type: 'string', description: 'Recipient email', required: false },
    { name: 'preferredLanguage', type: 'string', description: 'Preferred language', required: false },
    { name: 'communicationHistory', type: 'object', description: 'Communication history', required: false },
    { name: 'site', type: 'object', description: 'Site context', required: false },
    { name: 'pit', type: 'object', description: 'Pit context', required: false },
    { name: 'offtake', type: 'object', description: 'Offtake context', required: false },
    { name: 'financialContext', type: 'object', description: 'Financial context', required: false },
    { name: 'keyPoints', type: 'array', description: 'Key points to include', required: true },
    { name: 'avoidMentioning', type: 'array', description: 'Topics to avoid', required: false },
    { name: 'callToAction', type: 'string', description: 'Call to action', required: false },
    { name: 'deadline', type: 'string', description: 'Deadline if applicable', required: false },
    { name: 'customInstructions', type: 'string', description: 'Custom instructions', required: false },
  ],
  modelConstraints: {
    minCapabilityTier: 'standard',
    maxResponseTokens: 2048,
    temperature: 0.6,
  },
  guardrails: {
    maxInputLength: 10000,
    sanitizeInput: true,
    piiHandling: 'allow',
  },
  tags: ['communication', 'drafting', 'core'],
};

/**
 * Risk Alerting System Prompt
 */
export const RISK_ALERTING_SYSTEM_PROMPT = `You are a mining estate risk analysis expert for Borjie.

Your role is to:
1. Analyze risk indicators across the portfolio
2. Assess severity and urgency accurately
3. Identify root causes and contributing factors
4. Recommend immediate and preventive actions
5. Quantify financial exposure where possible
6. Create clear escalation paths

Risk Categories:
- FINANCIAL: Payment issues, revenue risks, cost overruns
- OPERATIONAL: Maintenance backlogs, vendor issues, process failures
- COMPLIANCE: Legal/regulatory risks, licence violations
- SAFETY: Physical safety hazards, liability risks
- COUNTERPARTY: Relationship risks, churn indicators
- SITE: Physical asset risks, market risks
- MARKET: External market changes affecting portfolio
- FRAUD: Suspicious activities, data anomalies

Severity Levels:
- Low: Monitor, no immediate action needed
- Medium: Attention required within days
- High: Immediate attention needed
- Critical: Urgent action required now

Always provide actionable recommendations with clear ownership.
Quantify financial impact where possible.
Consider historical patterns and trends.`;

/**
 * Risk Alerting Task Prompt
 */
export const RISK_ALERTING_PROMPT: CreatePromptRequest = {
  name: 'risk-alert-analysis',
  description: 'Analyze risk indicators and generate alerts with recommendations',
  domain: CopilotDomain.RISK_ALERTING,
  category: PromptCategory.TASK,
  riskLevel: RiskLevel.HIGH,
  systemPrompt: RISK_ALERTING_SYSTEM_PROMPT,
  template: `Analyze the following risk indicators and generate a comprehensive risk alert.

## Risk Category
**Category:** {{category}}

## Risk Indicators Detected
{{#each indicators}}
### {{name}}
- **Value:** {{value}}
- **Threshold:** {{threshold}}
- **Severity:** {{severity}}
- **Description:** {{description}}
{{/each}}

## Affected Entities
{{#each affectedEntities}}
- **{{type}}:** {{name}} (ID: {{id}})
  {{#if additionalInfo}}Additional Info: {{additionalInfo}}{{/if}}
{{/each}}

{{#if historicalContext}}
## Historical Context
- Previous Occurrences: {{historicalContext.previousOccurrences}}
{{#if historicalContext.lastOccurrence}}- Last Occurrence: {{historicalContext.lastOccurrence}}{{/if}}
- Trend: {{historicalContext.trend}}
{{#if historicalContext.previousActions}}
- Previous Actions Taken:
{{#each historicalContext.previousActions}}
  - {{this}}
{{/each}}
{{/if}}
{{/if}}

{{#if relatedData}}
## Related Data
{{relatedData}}
{{/if}}

## Required Output (JSON format)
{
  "alert": {
    "title": "concise alert title",
    "description": "detailed description of the risk",
    "severity": "low|medium|high|critical",
    "urgency": "informational|monitor|action-required|immediate",
    "riskScore": 0-100,
    "potentialImpact": "description of potential impact",
    "financialExposure": {
      "min": 0,
      "max": 0,
      "likely": 0,
      "currency": "<ISO-4217, e.g. TZS/KES/UGX>"
    }
  },
  "rootCauseAnalysis": {
    "primaryCauses": ["cause1", "cause2"],
    "contributingFactors": ["factor1", "factor2"],
    "uncertainties": ["uncertainty1"]
  },
  "recommendedActions": {
    "immediate": [
      { "action": "action description", "owner": "role", "deadline": "timeframe", "automationAvailable": false }
    ],
    "shortTerm": [
      { "action": "action description", "owner": "role", "timeframe": "timeframe" }
    ],
    "preventive": [
      { "action": "action description", "benefit": "expected benefit" }
    ]
  },
  "monitoring": {
    "metricsToWatch": ["metric1", "metric2"],
    "escalationTriggers": ["trigger1", "trigger2"],
    "reviewFrequency": "daily|weekly|monthly"
  },
  "notifications": {
    "recipients": [
      { "role": "role name", "channel": "EMAIL|SMS|IN_APP", "message": "brief message" }
    ],
    "escalationPath": [
      { "level": 1, "role": "role name", "triggerCondition": "condition" }
    ]
  }
}`,
  variables: [
    { name: 'category', type: 'string', description: 'Risk category', required: true },
    { name: 'indicators', type: 'array', description: 'Risk indicators detected', required: true },
    { name: 'affectedEntities', type: 'array', description: 'Affected entities', required: true },
    { name: 'historicalContext', type: 'object', description: 'Historical context', required: false },
    { name: 'relatedData', type: 'object', description: 'Additional related data', required: false },
  ],
  modelConstraints: {
    minCapabilityTier: 'advanced',
    maxResponseTokens: 3072,
    temperature: 0.3,
  },
  guardrails: {
    maxInputLength: 15000,
    sanitizeInput: true,
    piiHandling: 'redact',
  },
  tags: ['risk', 'alerting', 'analysis', 'core'],
};

/**
 * All default prompts for easy registration
 */
export const DEFAULT_PROMPTS: CreatePromptRequest[] = [
  MAINTENANCE_TRIAGE_PROMPT,
  OWNER_REPORTING_PROMPT,
  COMMUNICATION_DRAFTING_PROMPT,
  RISK_ALERTING_PROMPT,
];
