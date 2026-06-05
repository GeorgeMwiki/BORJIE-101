/**
 * Morning Briefing Generator
 * 
 * Generates daily operational briefings for site managers
 * with AI-powered insights and actionable items.
 */

import type { TenantId, SiteId, UserId } from '../types/index.js';
import type {
  KPIEngine,
  PortfolioSummaryKPIs,
  KPIAlert,
  KPIPeriod,
} from './kpi-engine.service.js';
import { logger } from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface BriefingRecipient {
  userId: UserId;
  name: string;
  email: string;
  role: string;
  siteIds?: SiteId[]; // Scope to specific sites
}

export interface UrgentItem {
  id: string;
  type: 'work_order' | 'payment' | 'supply_agreement' | 'compliance' | 'escalation' | 'alert';
  priority: 'critical' | 'high' | 'medium';
  title: string;
  description: string;
  actionRequired: string;
  actionUrl?: string;
  dueAt?: Date;
  siteId?: SiteId;
  siteName?: string;
}

export interface ScheduledItem {
  id: string;
  time: string;
  type: 'inspection' | 'vendor_visit' | 'meeting' | 'onboarding' | 'offboarding' | 'renewal' | 'other';
  title: string;
  description: string;
  location?: string;
  participants?: string[];
  siteId?: SiteId;
  siteName?: string;
}

export interface AIInsight {
  id: string;
  type: 'churn_risk' | 'maintenance_prediction' | 'collection_trend' | 'optimization' | 'anomaly';
  confidence: number;
  title: string;
  description: string;
  suggestedAction?: string;
  siteId?: SiteId;
}

export interface ExpiringItem {
  id: string;
  type: 'supply_agreement' | 'insurance' | 'license' | 'contract' | 'document';
  name: string;
  expiresAt: Date;
  daysRemaining: number;
  status: 'pending_action' | 'in_progress' | 'scheduled';
  siteId?: SiteId;
  siteName?: string;
}

export interface QuickMetric {
  name: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  changePercent?: number;
  status: 'good' | 'warning' | 'critical' | 'neutral';
}

export interface WeatherInfo {
  temperature: number;
  condition: string;
  icon: string;
  forecast?: string;
}

export interface MorningBriefing {
  id: string;
  tenantId: TenantId;
  recipient: BriefingRecipient;
  generatedAt: Date;
  date: string; // YYYY-MM-DD

  // Header section
  greeting: string;
  dayOfWeek: string;
  weather?: WeatherInfo;

  // Key metrics overview
  quickMetrics: QuickMetric[];

  // Action items
  urgentItems: UrgentItem[];
  scheduledToday: ScheduledItem[];
  expiringSoon: ExpiringItem[];

  // Insights
  alerts: KPIAlert[];
  aiInsights: AIInsight[];

  // Portfolio summary
  portfolioSnapshot: {
    totalSites: number;
    totalUnits: number;
    assetUtilisationRate: number;
    collectionRate: number;
    openWorkOrders: number;
    outstandingAccounts: number;
  };

  // Vendor information
  vendorUpdates: {
    visitsToday: number;
    pendingApprovals: number;
    topPerformer?: { name: string; score: number };
  };

  // Yesterday's summary
  yesterdaySummary?: {
    paymentsReceived: number;
    workOrdersCompleted: number;
    newAgreements: number;
    issues: string[];
  };

  // Motivational/informational
  tip?: string;
  quote?: string;
}

// ============================================================================
// Data Provider Interface
// ============================================================================

export interface IMorningBriefingDataProvider {
  getUrgentItems(tenantId: TenantId, siteIds?: SiteId[]): Promise<UrgentItem[]>;
  getScheduledItems(tenantId: TenantId, date: Date, siteIds?: SiteId[]): Promise<ScheduledItem[]>;
  getExpiringItems(tenantId: TenantId, daysAhead: number, siteIds?: SiteId[]): Promise<ExpiringItem[]>;
  getAIInsights(tenantId: TenantId, siteIds?: SiteId[]): Promise<AIInsight[]>;
  getYesterdaySummary(tenantId: TenantId, siteIds?: SiteId[]): Promise<MorningBriefing['yesterdaySummary']>;
  getVendorUpdates(tenantId: TenantId): Promise<MorningBriefing['vendorUpdates']>;
  getWeather?(location?: string): Promise<WeatherInfo | null>;
  getRecipients(tenantId: TenantId): Promise<BriefingRecipient[]>;
  getPortfolioStats(tenantId: TenantId, siteIds?: SiteId[]): Promise<MorningBriefing['portfolioSnapshot']>;
}

// ============================================================================
// Morning Briefing Service
// ============================================================================

export class MorningBriefingService {
  private readonly tips: string[] = [
    'Proactive communication with tenants reduces support requests by 40%.',
    'Schedule preventive maintenance during low-utilisation periods.',
    'Follow up on overdue payments within the first 7 days for best results.',
    'Regular site inspections help identify issues before they escalate.',
    'Renewing supply agreements 90 days before expiry increases retention rates.',
    'Keep vendor scorecards updated for better service quality.',
    'Document all buyer interactions for compliance and reference.',
    'Energy efficiency upgrades can reduce operating costs by 15-20%.',
  ];

  private readonly quotes: string[] = [
    '"The key to successful mining-estate management is proactive maintenance and clear communication." - Industry Expert',
    '"A well-maintained site attracts and retains quality buyers." - Mining Operations Wisdom',
    '"In mining-estate management, the small details make the biggest difference." - Operations Best Practice',
    '"Customer satisfaction is not a department, it\'s everyone\'s job." - Service Excellence',
  ];

  constructor(
    private readonly dataProvider: IMorningBriefingDataProvider,
    private readonly kpiEngine: KPIEngine
  ) {}

  /**
   * Generate morning briefing for a specific recipient
   */
  async generateBriefing(
    tenantId: TenantId,
    recipient: BriefingRecipient
  ): Promise<MorningBriefing> {
    const now = new Date();
    const siteIds = recipient.siteIds;

    // Fetch all data in parallel
    const [
      urgentItems,
      scheduledToday,
      expiringItems,
      aiInsights,
      yesterdaySummary,
      vendorUpdates,
      portfolioSnapshot,
      kpiAlerts,
      weather,
    ] = await Promise.all([
      this.dataProvider.getUrgentItems(tenantId, siteIds),
      this.dataProvider.getScheduledItems(tenantId, now, siteIds),
      this.dataProvider.getExpiringItems(tenantId, 30, siteIds),
      this.dataProvider.getAIInsights(tenantId, siteIds),
      this.dataProvider.getYesterdaySummary(tenantId, siteIds),
      this.dataProvider.getVendorUpdates(tenantId),
      this.dataProvider.getPortfolioStats(tenantId, siteIds),
      this.getKPIAlerts(tenantId, siteIds),
      // Follow-up KI-005 (#33): weather location should come from tenant.primaryCity
      //   once the tenants-table migration lands. Passing undefined lets
      //   the provider fall back to its own default or skip the lookup.
      //   See Docs/KNOWN_ISSUES.md#ki-005.
      this.dataProvider.getWeather?.() ?? Promise.resolve(null),
    ]);

    // Build quick metrics
    const quickMetrics = this.buildQuickMetrics(portfolioSnapshot, yesterdaySummary);

    // Generate personalized greeting
    const greeting = this.generateGreeting(recipient.name, now);
    // Follow-up KI-005 (#33): locale should come from recipient.locale /
    //   tenant.defaultLocale. Using bare 'en' fallback until plumbed.
    //   See Docs/KNOWN_ISSUES.md#ki-005.
    const dayOfWeek = now.toLocaleDateString('en', { weekday: 'long' });

    return {
      id: `briefing_${tenantId}_${now.toISOString().split('T')[0]}_${recipient.userId}`,
      tenantId,
      recipient,
      generatedAt: now,
      date: now.toISOString().split('T')[0] ?? '',
      greeting,
      dayOfWeek,
      ...(weather ? { weather } : {}),
      quickMetrics,
      urgentItems: urgentItems.slice(0, 10), // Top 10 urgent items
      scheduledToday: scheduledToday.sort((a, b) => a.time.localeCompare(b.time)),
      expiringSoon: expiringItems.filter((item) => item.daysRemaining <= 30).slice(0, 10),
      alerts: kpiAlerts.slice(0, 5),
      aiInsights: aiInsights.slice(0, 5),
      portfolioSnapshot,
      vendorUpdates,
      ...(yesterdaySummary !== undefined ? { yesterdaySummary } : {}),
      tip: this.getRandomTip(),
      quote: this.getRandomQuote(),
    };
  }

  /**
   * Generate briefings for all recipients in a tenant
   */
  async generateAllBriefings(tenantId: TenantId): Promise<MorningBriefing[]> {
    const recipients = await this.dataProvider.getRecipients(tenantId);
    const briefings: MorningBriefing[] = [];

    for (const recipient of recipients) {
      try {
        const briefing = await this.generateBriefing(tenantId, recipient);
        briefings.push(briefing);
      } catch (error) {
        logger.error(`Failed to generate briefing for ${recipient.userId}`, { error: error });
      }
    }

    return briefings;
  }

  /**
   * Format briefing for email delivery
   */
  formatForEmail(briefing: MorningBriefing): { subject: string; html: string; text: string } {
    const subject = `${briefing.dayOfWeek} Briefing - ${briefing.date}`;

    // Plain text version
    const text = this.formatPlainText(briefing);

    // HTML version
    const html = this.formatHTML(briefing);

    return { subject, html, text };
  }

  /**
   * Format briefing for WhatsApp delivery (condensed)
   */
  formatForWhatsApp(briefing: MorningBriefing): string {
    const lines: string[] = [];

    lines.push(`📋 *${briefing.dayOfWeek} Briefing*`);
    lines.push(`${briefing.date}`);
    lines.push('');
    lines.push(briefing.greeting);
    lines.push('');

    // Quick stats
    lines.push('📊 *Quick Stats*');
    lines.push(`• Asset Utilisation: ${briefing.portfolioSnapshot.assetUtilisationRate.toFixed(1)}%`);
    lines.push(`• Collection: ${briefing.portfolioSnapshot.collectionRate.toFixed(1)}%`);
    lines.push(`• Open Work Orders: ${briefing.portfolioSnapshot.openWorkOrders}`);
    lines.push('');

    // Urgent items
    if (briefing.urgentItems.length > 0) {
      lines.push('⚠️ *Urgent Items*');
      briefing.urgentItems.slice(0, 5).forEach((item) => {
        const icon = item.priority === 'critical' ? '🔴' : item.priority === 'high' ? '🟠' : '🟡';
        lines.push(`${icon} ${item.title}`);
      });
      lines.push('');
    }

    // Today's schedule
    if (briefing.scheduledToday.length > 0) {
      lines.push('📅 *Today\'s Schedule*');
      briefing.scheduledToday.slice(0, 5).forEach((item) => {
        lines.push(`• ${item.time}: ${item.title}`);
      });
      lines.push('');
    }

    // AI insight (just one)
    if (briefing.aiInsights.length > 0) {
      const insight = briefing.aiInsights[0];
      lines.push('💡 *AI Insight*');
      lines.push(`${insight?.title}`);
      lines.push('');
    }

    lines.push(`💭 ${briefing.tip}`);

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async getKPIAlerts(tenantId: TenantId, siteIds?: SiteId[]): Promise<KPIAlert[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const period: KPIPeriod = {
      start: startOfMonth,
      end: now,
      label: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    };

    try {
      return await this.kpiEngine.getKPIAlerts(tenantId, period);
    } catch (err) {
      logger.warn('[morning-briefing] failed to load KPI alerts, returning empty list', { value: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  private buildQuickMetrics(
    portfolio: MorningBriefing['portfolioSnapshot'],
    yesterday?: MorningBriefing['yesterdaySummary']
  ): QuickMetric[] {
    return [
      {
        name: 'Asset Utilisation Rate',
        value: portfolio.assetUtilisationRate,
        unit: '%',
        status: portfolio.assetUtilisationRate >= 90 ? 'good' : portfolio.assetUtilisationRate >= 80 ? 'warning' : 'critical',
      },
      {
        name: 'Collection Rate',
        value: portfolio.collectionRate,
        unit: '%',
        status: portfolio.collectionRate >= 95 ? 'good' : portfolio.collectionRate >= 85 ? 'warning' : 'critical',
      },
      {
        name: 'Open Work Orders',
        value: portfolio.openWorkOrders,
        status: portfolio.openWorkOrders <= 5 ? 'good' : portfolio.openWorkOrders <= 15 ? 'warning' : 'critical',
      },
      {
        name: 'Outstanding Accounts',
        value: portfolio.outstandingAccounts,
        status: portfolio.outstandingAccounts <= 3 ? 'good' : portfolio.outstandingAccounts <= 10 ? 'warning' : 'critical',
      },
      {
        name: 'Payments Yesterday',
        value: yesterday?.paymentsReceived ?? 0,
        status: 'neutral',
      },
      {
        name: 'Work Orders Completed',
        value: yesterday?.workOrdersCompleted ?? 0,
        status: 'neutral',
      },
    ];
  }

  private generateGreeting(name: string, date: Date): string {
    const hour = date.getHours();
    let timeGreeting: string;

    if (hour < 12) {
      timeGreeting = 'Good morning';
    } else if (hour < 17) {
      timeGreeting = 'Good afternoon';
    } else {
      timeGreeting = 'Good evening';
    }

    const firstName = name.split(' ')[0];
    return `${timeGreeting}, ${firstName}! Here's your daily briefing.`;
  }

  private getRandomTip(): string {
    return this.tips[Math.floor(Math.random() * this.tips.length)] ?? this.tips[0] ?? '';
  }

  private getRandomQuote(): string {
    return this.quotes[Math.floor(Math.random() * this.quotes.length)] ?? this.quotes[0] ?? '';
  }

  private formatPlainText(briefing: MorningBriefing): string {
    const lines: string[] = [];

    lines.push(`${briefing.dayOfWeek} Briefing - ${briefing.date}`);
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(briefing.greeting);
    lines.push('');

    // Portfolio Snapshot
    lines.push('PORTFOLIO SNAPSHOT');
    lines.push('-'.repeat(30));
    lines.push(`Sites: ${briefing.portfolioSnapshot.totalSites}`);
    lines.push(`Units: ${briefing.portfolioSnapshot.totalUnits}`);
    lines.push(`Asset Utilisation: ${briefing.portfolioSnapshot.assetUtilisationRate.toFixed(1)}%`);
    lines.push(`Collection Rate: ${briefing.portfolioSnapshot.collectionRate.toFixed(1)}%`);
    lines.push(`Open Work Orders: ${briefing.portfolioSnapshot.openWorkOrders}`);
    lines.push(`Outstanding Accounts: ${briefing.portfolioSnapshot.outstandingAccounts}`);
    lines.push('');

    // Urgent Items
    if (briefing.urgentItems.length > 0) {
      lines.push('URGENT ITEMS');
      lines.push('-'.repeat(30));
      briefing.urgentItems.forEach((item, i) => {
        lines.push(`${i + 1}. [${item.priority.toUpperCase()}] ${item.title}`);
        lines.push(`   ${item.description}`);
        lines.push(`   Action: ${item.actionRequired}`);
      });
      lines.push('');
    }

    // Today's Schedule
    if (briefing.scheduledToday.length > 0) {
      lines.push("TODAY'S SCHEDULE");
      lines.push('-'.repeat(30));
      briefing.scheduledToday.forEach((item) => {
        lines.push(`${item.time} - ${item.title}`);
        if (item.location) lines.push(`  Location: ${item.location}`);
      });
      lines.push('');
    }

    // Alerts
    if (briefing.alerts.length > 0) {
      lines.push('KPI ALERTS');
      lines.push('-'.repeat(30));
      briefing.alerts.forEach((alert) => {
        lines.push(`[${alert.severity.toUpperCase()}] ${alert.message}`);
      });
      lines.push('');
    }

    // AI Insights
    if (briefing.aiInsights.length > 0) {
      lines.push('AI INSIGHTS');
      lines.push('-'.repeat(30));
      briefing.aiInsights.forEach((insight) => {
        lines.push(`• ${insight.title}`);
        lines.push(`  ${insight.description}`);
        if (insight.suggestedAction) {
          lines.push(`  Suggested: ${insight.suggestedAction}`);
        }
      });
      lines.push('');
    }

    // Expiring Soon
    if (briefing.expiringSoon.length > 0) {
      lines.push('EXPIRING SOON');
      lines.push('-'.repeat(30));
      briefing.expiringSoon.slice(0, 5).forEach((item) => {
        lines.push(`• ${item.name} - ${item.daysRemaining} days (${item.type})`);
      });
      lines.push('');
    }

    // Tip
    if (briefing.tip) {
      lines.push('TIP OF THE DAY');
      lines.push('-'.repeat(30));
      lines.push(briefing.tip);
    }

    return lines.join('\n');
  }

  private formatHTML(briefing: MorningBriefing): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 24px; font-size: 18px; }
    .greeting { font-size: 16px; color: #4b5563; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
    .metric { background: #f3f4f6; padding: 12px; border-radius: 8px; text-align: center; }
    .metric-value { font-size: 24px; font-weight: bold; color: #1f2937; }
    .metric-label { font-size: 12px; color: #6b7280; }
    .metric.good { background: #d1fae5; }
    .metric.warning { background: #fef3c7; }
    .metric.critical { background: #fee2e2; }
    .urgent-item { padding: 12px; margin: 8px 0; border-left: 4px solid; background: #fff; border-radius: 4px; }
    .urgent-item.critical { border-color: #dc2626; background: #fef2f2; }
    .urgent-item.high { border-color: #f59e0b; background: #fffbeb; }
    .urgent-item.medium { border-color: #3b82f6; background: #eff6ff; }
    .schedule-item { display: flex; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .schedule-time { width: 60px; font-weight: bold; color: #2563eb; }
    .alert { padding: 8px 12px; margin: 4px 0; border-radius: 4px; font-size: 14px; }
    .alert.critical { background: #fef2f2; color: #991b1b; }
    .alert.warning { background: #fffbeb; color: #92400e; }
    .insight { background: #eef2ff; padding: 12px; margin: 8px 0; border-radius: 8px; }
    .insight-title { font-weight: 600; color: #3730a3; }
    .tip { background: #f0fdf4; padding: 16px; border-radius: 8px; margin-top: 24px; }
    .tip-icon { font-size: 20px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <h1>📋 ${briefing.dayOfWeek} Briefing</h1>
  <p class="greeting">${briefing.greeting}</p>
  
  <h2>📊 Portfolio Snapshot</h2>
  <div class="metric-grid">
    <div class="metric ${briefing.portfolioSnapshot.assetUtilisationRate >= 90 ? 'good' : briefing.portfolioSnapshot.assetUtilisationRate >= 80 ? 'warning' : 'critical'}">
      <div class="metric-value">${briefing.portfolioSnapshot.assetUtilisationRate.toFixed(1)}%</div>
      <div class="metric-label">Asset Utilisation</div>
    </div>
    <div class="metric ${briefing.portfolioSnapshot.collectionRate >= 95 ? 'good' : briefing.portfolioSnapshot.collectionRate >= 85 ? 'warning' : 'critical'}">
      <div class="metric-value">${briefing.portfolioSnapshot.collectionRate.toFixed(1)}%</div>
      <div class="metric-label">Collection</div>
    </div>
    <div class="metric ${briefing.portfolioSnapshot.openWorkOrders <= 5 ? 'good' : briefing.portfolioSnapshot.openWorkOrders <= 15 ? 'warning' : 'critical'}">
      <div class="metric-value">${briefing.portfolioSnapshot.openWorkOrders}</div>
      <div class="metric-label">Open Work Orders</div>
    </div>
  </div>

  ${briefing.urgentItems.length > 0 ? `
  <h2>⚠️ Urgent Items</h2>
  ${briefing.urgentItems.slice(0, 5).map(item => `
    <div class="urgent-item ${item.priority}">
      <strong>${item.title}</strong>
      <p style="margin: 4px 0; font-size: 14px;">${item.description}</p>
      <p style="margin: 0; font-size: 13px; color: #4b5563;">Action: ${item.actionRequired}</p>
    </div>
  `).join('')}
  ` : ''}

  ${briefing.scheduledToday.length > 0 ? `
  <h2>📅 Today's Schedule</h2>
  ${briefing.scheduledToday.map(item => `
    <div class="schedule-item">
      <span class="schedule-time">${item.time}</span>
      <span>${item.title}${item.location ? ` - ${item.location}` : ''}</span>
    </div>
  `).join('')}
  ` : ''}

  ${briefing.alerts.length > 0 ? `
  <h2>🔔 Alerts</h2>
  ${briefing.alerts.map(alert => `
    <div class="alert ${alert.severity}">${alert.message}</div>
  `).join('')}
  ` : ''}

  ${briefing.aiInsights.length > 0 ? `
  <h2>💡 AI Insights</h2>
  ${briefing.aiInsights.slice(0, 3).map(insight => `
    <div class="insight">
      <div class="insight-title">${insight.title}</div>
      <p style="margin: 4px 0 0 0; font-size: 14px;">${insight.description}</p>
      ${insight.suggestedAction ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: #4338ca;">Suggested: ${insight.suggestedAction}</p>` : ''}
    </div>
  `).join('')}
  ` : ''}

  <div class="tip">
    <span class="tip-icon">💡</span>
    <strong>Tip of the Day:</strong>
    <p style="margin: 4px 0 0 0;">${briefing.tip}</p>
  </div>

  <div class="footer">
    <p>Generated at ${briefing.generatedAt.toLocaleString()} | BORJIE Mining Estate OS</p>
  </div>
</body>
</html>
    `.trim();
  }
}
