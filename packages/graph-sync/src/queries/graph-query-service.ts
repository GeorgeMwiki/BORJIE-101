/**
 * GraphQueryService — Safe, tenant-isolated graph query endpoints
 *
 * This is the primary interface between the AI agent layer and the CPG.
 * Every method:
 *  1. Requires tenantId (enforced — no cross-tenant data leakage)
 *  2. Returns structured results with evidence paths
 *  3. Is parameterized (no string interpolation — prevents Cypher injection)
 *  4. Returns graph paths as evidence references for AI citations
 *
 * The AI agent calls these methods through the tool layer.
 */

import type { Neo4jClient } from '../client/neo4j-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphEvidencePath {
  nodeId: string;
  nodeLabel: string;
  nodeProperties: Record<string, unknown>;
  relationship?: string;
  direction?: 'outgoing' | 'incoming';
}

export interface CaseTimelineEntry {
  timestamp: string;
  eventType: string;
  nodeLabel: string;
  nodeId: string;
  title: string;
  description?: string;
  actor?: string;
  evidencePath: GraphEvidencePath[];
}

export interface TenantRiskDriver {
  factor: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  evidence: GraphEvidencePath[];
}

export interface TenantRiskProfile {
  customerId: string;
  customerName: string;
  overallRiskLevel: string;
  overallRiskScore: number;
  drivers: TenantRiskDriver[];
  churnProbability: number;
  recommendations: string[];
}

export interface VendorScorecardEntry {
  vendorId: string;
  vendorName: string;
  totalWorkOrders: number;
  completedWorkOrders: number;
  avgCompletionDays: number;
  reopenRate: number;
  avgCost: number;
  topAssetTypes: string[];
  qualityIssues: Array<{
    workOrderId: string;
    assetType: string;
    reopenedCount: number;
    description: string;
  }>;
}

export interface UnitHealthReport {
  unitId: string;
  unitName: string;
  propertyName: string;
  occupancyStatus: string;
  activeIssuesCount: number;
  openWorkOrders: number;
  overdueInvoices: number;
  lastInspectionDate?: string;
  maintenanceCostLast12m: number;
  sentimentScore?: number;
  healthScore: number;
  issues: Array<{
    type: string;
    description: string;
    evidence: GraphEvidencePath[];
  }>;
}

export interface ParcelComplianceReport {
  parcelId: string;
  parcelName?: string;
  expiringDocuments: Array<{
    documentId: string;
    documentType: string;
    expiresAt: string;
    daysUntilExpiry: number;
  }>;
  expiringLeases: Array<{
    leaseId: string;
    tenantName: string;
    expiresAt: string;
    daysUntilExpiry: number;
  }>;
  pendingTasks: Array<{
    taskId: string;
    taskType: string;
    dueDate: string;
    description: string;
  }>;
  overallComplianceScore: number;
}

export interface PropertyRollup {
  propertyId: string;
  propertyName: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  activeLeases: number;
  openWorkOrders: number;
  overdueInvoices: number;
  totalRevenue: number;
  totalArrears: number;
  avgSentiment: number;
  occupancyRate: number;
}

export interface EvidencePackResult {
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  generatedAt: string;
  totalItems: number;
  items: Array<{
    nodeLabel: string;
    nodeId: string;
    timestamp: string;
    title: string;
    type: string;
    properties: Record<string, unknown>;
    connectionPath: string;
  }>;
}

export interface NaturalLanguageQueryResult {
  answer: string;
  confidence: number;
  evidencePaths: GraphEvidencePath[][];
  cypherUsed: string;
  executionTimeMs: number;
}

// ─── GraphQueryService ───────────────────────────────────────────────────────

export class GraphQueryService {
  constructor(private client: Neo4jClient) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // A) Case Timeline — "Show me everything related to Case X in time order"
  // ═══════════════════════════════════════════════════════════════════════════

  async getCaseTimeline(tenantId: string, caseId: string): Promise<CaseTimelineEntry[]> {
    const cypher = `
      MATCH (c:Case {_tenantId: $tenantId, _id: $caseId})
      OPTIONAL MATCH (c)-[r1]-(related)
      WHERE related._tenantId = $tenantId
      WITH c, related, type(r1) AS relType
      OPTIONAL MATCH (related)-[r2]-(deeper)
      WHERE deeper._tenantId = $tenantId
        AND NOT deeper:Case
      WITH c, related, relType, deeper, type(r2) AS deepRelType
      WITH c,
           collect(DISTINCT {
             nodeLabel: CASE WHEN related IS NOT NULL THEN head(labels(related)) ELSE null END,
             nodeId: related._id,
             title: COALESCE(related.title, related.subject, related.name, related.caseNumber, related._id),
             description: related.description,
             timestamp: COALESCE(related.occurredAt, related.sentAt, related.createdAt, related.processedAt),
             relationship: relType,
             properties: properties(related)
           }) AS directNodes,
           collect(DISTINCT {
             nodeLabel: CASE WHEN deeper IS NOT NULL THEN head(labels(deeper)) ELSE null END,
             nodeId: deeper._id,
             title: COALESCE(deeper.title, deeper.subject, deeper.name, deeper._id),
             description: deeper.description,
             timestamp: COALESCE(deeper.occurredAt, deeper.sentAt, deeper.createdAt, deeper.processedAt),
             relationship: deepRelType,
             properties: properties(deeper)
           }) AS deeperNodes
      WITH directNodes + deeperNodes AS allNodes
      UNWIND allNodes AS node
      WITH node WHERE node.nodeId IS NOT NULL
      RETURN DISTINCT
        node.timestamp AS timestamp,
        node.nodeLabel AS nodeLabel,
        node.nodeId AS nodeId,
        node.title AS title,
        node.description AS description,
        node.relationship AS eventType
      ORDER BY node.timestamp ASC
    `;

    const records = await this.client.readQuery<{
      timestamp: string;
      nodeLabel: string;
      nodeId: string;
      title: string;
      description: string;
      eventType: string;
    }>(cypher, { tenantId, caseId });

    return records.map(r => ({
      timestamp: String(r.timestamp ?? ''),
      eventType: String(r.eventType ?? 'related'),
      nodeLabel: String(r.nodeLabel ?? ''),
      nodeId: String(r.nodeId ?? ''),
      title: String(r.title ?? ''),
      ...(r.description != null ? { description: String(r.description) } : {}),
      evidencePath: [{
        nodeId: String(r.nodeId ?? ''),
        nodeLabel: String(r.nodeLabel ?? ''),
        nodeProperties: {},
        relationship: String(r.eventType ?? ''),
      }],
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // B) Tenant Risk Drivers — "Why is Customer A at risk?"
  // ═══════════════════════════════════════════════════════════════════════════

  async getTenantRiskDrivers(tenantId: string, customerId: string): Promise<TenantRiskProfile> {
    const cypher = `
      MATCH (cust:Customer {_tenantId: $tenantId, _id: $customerId})

      // Unresolved work orders
      OPTIONAL MATCH (cust)<-[:BILLED_TO]-(inv:Invoice)-[:FOR_LEASE]->(l:Lease)-[:APPLIES_TO]->(u:Unit)
      WHERE u._tenantId = $tenantId
      OPTIONAL MATCH (u)<-[:TARGETS]-(wo:WorkOrder {_tenantId: $tenantId})
      WHERE wo.status IN ['open', 'assigned', 'scheduled', 'in_progress', 'escalated']
      WITH cust, collect(DISTINCT wo) AS openWorkOrders, collect(DISTINCT u) AS units

      // Overdue invoices
      OPTIONAL MATCH (cust)<-[:BILLED_TO]-(overdueInv:Invoice {_tenantId: $tenantId})
      WHERE overdueInv.status IN ['overdue', 'past_due']
         OR (overdueInv.dueDate IS NOT NULL AND overdueInv.dueDate < datetime() AND overdueInv.status <> 'paid')
      WITH cust, openWorkOrders, units, collect(DISTINCT overdueInv) AS overdueInvoices

      // Active cases
      OPTIONAL MATCH (cust)<-[:OPENED_BY]-(activeCase:Case {_tenantId: $tenantId})
      WHERE activeCase.status IN ['open', 'investigating', 'pending_response', 'escalated']
      WITH cust, openWorkOrders, units, overdueInvoices, collect(DISTINCT activeCase) AS activeCases

      // Active leases
      OPTIONAL MATCH (cust)-[:HAS_LEASE]->(lease:Lease {_tenantId: $tenantId})
      WHERE lease.status = 'active'
      WITH cust, openWorkOrders, units, overdueInvoices, activeCases, collect(DISTINCT lease) AS activeLeases

      RETURN
        cust._id AS customerId,
        COALESCE(cust.firstName + ' ' + cust.lastName, cust.name, cust._id) AS customerName,
        size(openWorkOrders) AS unresolvedWorkOrders,
        size(overdueInvoices) AS overdueInvoiceCount,
        size(activeCases) AS activeCaseCount,
        size(activeLeases) AS activeLeaseCount,
        [wo IN openWorkOrders | {id: wo._id, title: wo.title, priority: wo.priority, status: wo.status}] AS workOrderDetails,
        [inv IN overdueInvoices | {id: inv._id, amount: inv.amount, dueDate: inv.dueDate}] AS overdueDetails,
        [c IN activeCases | {id: c._id, title: c.title, severity: c.severity, type: c.caseType}] AS caseDetails
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, customerId });

    if (records.length === 0) {
      return {
        customerId,
        customerName: 'Unknown',
        overallRiskLevel: 'unknown',
        overallRiskScore: 0,
        drivers: [],
        churnProbability: 0,
        recommendations: [],
      };
    }

    const r = records[0]!;
    const drivers: TenantRiskDriver[] = [];

    const unresolvedWO = toNumber(r.unresolvedWorkOrders);
    const overdueCount = toNumber(r.overdueInvoiceCount);
    const caseCount = toNumber(r.activeCaseCount);

    if (overdueCount > 0) {
      drivers.push({
        factor: 'Overdue invoices',
        severity: overdueCount >= 3 ? 'critical' : overdueCount >= 2 ? 'high' : 'medium',
        score: Math.min(overdueCount * 25, 100),
        description: `${overdueCount} overdue invoice(s) detected`,
        evidence: (r.overdueDetails as Array<Record<string, unknown>> ?? []).map(inv => ({
          nodeId: String(inv.id),
          nodeLabel: 'Invoice',
          nodeProperties: inv,
          relationship: 'BILLED_TO',
        })),
      });
    }

    if (unresolvedWO > 0) {
      drivers.push({
        factor: 'Unresolved maintenance',
        severity: unresolvedWO >= 3 ? 'high' : 'medium',
        score: Math.min(unresolvedWO * 20, 100),
        description: `${unresolvedWO} unresolved work order(s)`,
        evidence: (r.workOrderDetails as Array<Record<string, unknown>> ?? []).map(wo => ({
          nodeId: String(wo.id),
          nodeLabel: 'WorkOrder',
          nodeProperties: wo,
          relationship: 'TARGETS',
        })),
      });
    }

    if (caseCount > 0) {
      drivers.push({
        factor: 'Active disputes',
        severity: caseCount >= 2 ? 'high' : 'medium',
        score: Math.min(caseCount * 30, 100),
        description: `${caseCount} active case(s)/dispute(s)`,
        evidence: (r.caseDetails as Array<Record<string, unknown>> ?? []).map(c => ({
          nodeId: String(c.id),
          nodeLabel: 'Case',
          nodeProperties: c,
          relationship: 'OPENED_BY',
        })),
      });
    }

    const overallScore = drivers.reduce((sum, d) => sum + d.score, 0) / Math.max(drivers.length, 1);
    const overallLevel = overallScore >= 75 ? 'critical' : overallScore >= 50 ? 'high' : overallScore >= 25 ? 'medium' : 'low';
    const churnProbability = Math.min(overallScore / 100, 1);

    const recommendations: string[] = [];
    if (overdueCount > 0) recommendations.push('Initiate proactive payment plan discussion');
    if (unresolvedWO > 0) recommendations.push('Escalate unresolved maintenance to priority queue');
    if (caseCount > 0) recommendations.push('Schedule case review meeting with tenant');
    if (drivers.length === 0) recommendations.push('Tenant is in good standing — consider loyalty reward');

    return {
      customerId,
      customerName: String(r.customerName ?? 'Unknown'),
      overallRiskLevel: overallLevel,
      overallRiskScore: Math.round(overallScore),
      drivers,
      churnProbability: Math.round(churnProbability * 100) / 100,
      recommendations,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // C) Vendor Scorecard — "Which vendor has highest reopen rate?"
  // ═══════════════════════════════════════════════════════════════════════════

  async getVendorScorecard(
    tenantId: string,
    vendorId: string,
    windowDays: number = 365
  ): Promise<VendorScorecardEntry> {
    const cypher = `
      MATCH (v:Vendor {_tenantId: $tenantId, _id: $vendorId})
      OPTIONAL MATCH (wo:WorkOrder {_tenantId: $tenantId})-[:ASSIGNED_TO]->(v)
      WITH v, collect(wo) AS allWOs

      // Calculate metrics
      WITH v, allWOs,
           size(allWOs) AS totalWOs,
           size([wo IN allWOs WHERE wo.status = 'completed']) AS completedWOs,
           [wo IN allWOs WHERE wo.status = 'completed' AND wo.completedDate IS NOT NULL AND wo.createdAt IS NOT NULL |
             duration.between(datetime(wo.createdAt), datetime(wo.completedDate)).days
           ] AS completionDays

      // Get asset types worked on
      OPTIONAL MATCH (wo:WorkOrder {_tenantId: $tenantId})-[:ASSIGNED_TO]->(v)
      OPTIONAL MATCH (wo)-[:TARGETS]->(target)
      WITH v, totalWOs, completedWOs, completionDays,
           collect(DISTINCT COALESCE(target.assetType, head(labels(target)))) AS assetTypes

      RETURN
        v._id AS vendorId,
        COALESCE(v.name, v._id) AS vendorName,
        totalWOs,
        completedWOs,
        CASE WHEN size(completionDays) > 0
          THEN reduce(total = 0, d IN completionDays | total + d) / size(completionDays)
          ELSE 0 END AS avgCompletionDays,
        assetTypes
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, vendorId, windowDays });

    if (records.length === 0) {
      return {
        vendorId,
        vendorName: 'Unknown',
        totalWorkOrders: 0,
        completedWorkOrders: 0,
        avgCompletionDays: 0,
        reopenRate: 0,
        avgCost: 0,
        topAssetTypes: [],
        qualityIssues: [],
      };
    }

    const r = records[0]!;
    return {
      vendorId: String(r.vendorId),
      vendorName: String(r.vendorName ?? 'Unknown'),
      totalWorkOrders: toNumber(r.totalWOs),
      completedWorkOrders: toNumber(r.completedWOs),
      avgCompletionDays: toNumber(r.avgCompletionDays),
      reopenRate: 0,
      avgCost: 0,
      topAssetTypes: (r.assetTypes as string[] ?? []).filter(Boolean),
      qualityIssues: [],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // D) Unit Health — "What's the overall health of Unit X?"
  // ═══════════════════════════════════════════════════════════════════════════

  async getUnitHealth(tenantId: string, unitId: string): Promise<UnitHealthReport> {
    const cypher = `
      MATCH (u:Unit {_tenantId: $tenantId, _id: $unitId})
      OPTIONAL MATCH (u)<-[:APPLIES_TO]-(l:Lease {_tenantId: $tenantId})
      WHERE l.status = 'active'
      OPTIONAL MATCH (u)<-[:TARGETS]-(wo:WorkOrder {_tenantId: $tenantId})
      WHERE wo.status IN ['open', 'assigned', 'scheduled', 'in_progress']
      OPTIONAL MATCH (u)<-[:ABOUT]-(mr:MaintenanceRequest {_tenantId: $tenantId})
      OPTIONAL MATCH (u)<-[:FOR_UNIT]-(inv:Invoice {_tenantId: $tenantId})
      WHERE inv.status IN ['overdue', 'past_due']
      OPTIONAL MATCH (u)<-[:INSPECTS]-(insp:Inspection {_tenantId: $tenantId})
      OPTIONAL MATCH (u)<-[:HAS_UNIT]-(p:Property {_tenantId: $tenantId})

      RETURN
        u._id AS unitId,
        COALESCE(u.name, u.unitCode, u._id) AS unitName,
        COALESCE(p.name, '') AS propertyName,
        u.status AS occupancyStatus,
        size(collect(DISTINCT wo)) AS openWorkOrders,
        size(collect(DISTINCT inv)) AS overdueInvoices,
        size(collect(DISTINCT mr)) AS activeIssues,
        max(insp.scheduledDate) AS lastInspectionDate,
        collect(DISTINCT {id: wo._id, title: wo.title, priority: wo.priority}) AS workOrderList,
        collect(DISTINCT {id: inv._id, amount: inv.amount, dueDate: inv.dueDate}) AS overdueList
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, unitId });

    if (records.length === 0) {
      return {
        unitId,
        unitName: 'Unknown',
        propertyName: '',
        occupancyStatus: 'unknown',
        activeIssuesCount: 0,
        openWorkOrders: 0,
        overdueInvoices: 0,
        maintenanceCostLast12m: 0,
        healthScore: 0,
        issues: [],
      };
    }

    const r = records[0]!;
    const openWO = toNumber(r.openWorkOrders);
    const overdueInv = toNumber(r.overdueInvoices);
    const activeIssues = toNumber(r.activeIssues);

    const healthScore = Math.max(0, 100 - (openWO * 15) - (overdueInv * 20) - (activeIssues * 10));

    const issues: UnitHealthReport['issues'] = [];
    if (openWO > 0) {
      issues.push({
        type: 'maintenance',
        description: `${openWO} open work order(s)`,
        evidence: (r.workOrderList as Array<Record<string, unknown>> ?? [])
          .filter((wo): wo is Record<string, unknown> => wo.id != null)
          .map(wo => ({
            nodeId: String(wo.id),
            nodeLabel: 'WorkOrder',
            nodeProperties: wo,
          })),
      });
    }
    if (overdueInv > 0) {
      issues.push({
        type: 'financial',
        description: `${overdueInv} overdue invoice(s)`,
        evidence: (r.overdueList as Array<Record<string, unknown>> ?? [])
          .filter((inv): inv is Record<string, unknown> => inv.id != null)
          .map(inv => ({
            nodeId: String(inv.id),
            nodeLabel: 'Invoice',
            nodeProperties: inv,
          })),
      });
    }

    return {
      unitId,
      unitName: String(r.unitName),
      propertyName: String(r.propertyName),
      occupancyStatus: String(r.occupancyStatus ?? 'unknown'),
      activeIssuesCount: activeIssues,
      openWorkOrders: openWO,
      overdueInvoices: overdueInv,
      maintenanceCostLast12m: 0,
      healthScore: Math.round(healthScore),
      issues,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // E) Parcel Compliance — "Which parcels have expiring obligations?"
  // ═══════════════════════════════════════════════════════════════════════════

  async getParcelCompliance(tenantId: string, parcelId: string): Promise<ParcelComplianceReport> {
    const cypher = `
      MATCH (p:Parcel {_tenantId: $tenantId, _id: $parcelId})

      // Expiring documents
      OPTIONAL MATCH (p)-[:RELATES_TO|ATTACHED_TO]-(doc:Document {_tenantId: $tenantId})
      WHERE doc.expiresAt IS NOT NULL
      WITH p, collect(DISTINCT {
        id: doc._id,
        type: doc.type,
        expiresAt: doc.expiresAt
      }) AS docs

      // Expiring leases
      OPTIONAL MATCH (p)<-[:APPLIES_TO]-(ll:LandLease {_tenantId: $tenantId})
      WHERE ll.endDate IS NOT NULL
      WITH p, docs, collect(DISTINCT {
        id: ll._id,
        endDate: ll.endDate
      }) AS leases

      RETURN
        p._id AS parcelId,
        p.name AS parcelName,
        docs,
        leases
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, parcelId });

    if (records.length === 0) {
      return {
        parcelId,
        expiringDocuments: [],
        expiringLeases: [],
        pendingTasks: [],
        overallComplianceScore: 100,
      };
    }

    const r = records[0]!;
    const now = new Date();

    const expiringDocuments = ((r.docs as Array<Record<string, unknown>>) ?? [])
      .filter(d => d.expiresAt)
      .map(d => {
        const expiresAt = new Date(String(d.expiresAt));
        const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          documentId: String(d.id),
          documentType: String(d.type ?? 'unknown'),
          expiresAt: expiresAt.toISOString(),
          daysUntilExpiry,
        };
      })
      .filter(d => d.daysUntilExpiry <= 90);

    const expiringLeases = ((r.leases as Array<Record<string, unknown>>) ?? [])
      .filter(l => l.endDate)
      .map(l => {
        const expiresAt = new Date(String(l.endDate));
        const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          leaseId: String(l.id),
          tenantName: '',
          expiresAt: expiresAt.toISOString(),
          daysUntilExpiry,
        };
      })
      .filter(l => l.daysUntilExpiry <= 90);

    const urgentItems = expiringDocuments.filter(d => d.daysUntilExpiry <= 30).length +
                        expiringLeases.filter(l => l.daysUntilExpiry <= 30).length;
    const complianceScore = Math.max(0, 100 - (urgentItems * 20) - (expiringDocuments.length * 5) - (expiringLeases.length * 5));

    return {
      parcelId,
      ...(r.parcelName != null ? { parcelName: String(r.parcelName) } : {}),
      expiringDocuments,
      expiringLeases,
      pendingTasks: [],
      overallComplianceScore: Math.round(complianceScore),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // F) Property Rollup — Enterprise-level KPI rollup
  // ═══════════════════════════════════════════════════════════════════════════

  async getPropertyRollup(tenantId: string, propertyId: string): Promise<PropertyRollup> {
    const cypher = `
      MATCH (p:Property {_tenantId: $tenantId, _id: $propertyId})
      OPTIONAL MATCH (p)-[:HAS_UNIT]->(u:Unit {_tenantId: $tenantId})
      WITH p, collect(u) AS allUnits

      WITH p, allUnits,
           size(allUnits) AS totalUnits,
           size([u IN allUnits WHERE u.status = 'occupied']) AS occupiedUnits,
           size([u IN allUnits WHERE u.status = 'vacant']) AS vacantUnits

      // Active leases
      OPTIONAL MATCH (p)-[:HAS_UNIT]->(u2:Unit)<-[:APPLIES_TO]-(l:Lease {_tenantId: $tenantId})
      WHERE l.status = 'active'
      WITH p, totalUnits, occupiedUnits, vacantUnits, count(DISTINCT l) AS activeLeases

      // Open work orders
      OPTIONAL MATCH (p)-[:HAS_UNIT]->(u3:Unit)<-[:TARGETS]-(wo:WorkOrder {_tenantId: $tenantId})
      WHERE wo.status IN ['open', 'assigned', 'scheduled', 'in_progress']
      WITH p, totalUnits, occupiedUnits, vacantUnits, activeLeases, count(DISTINCT wo) AS openWorkOrders

      // Overdue invoices
      OPTIONAL MATCH (p)-[:HAS_UNIT]->(u4:Unit)<-[:FOR_UNIT]-(inv:Invoice {_tenantId: $tenantId})
      WHERE inv.status IN ['overdue', 'past_due']
      WITH p, totalUnits, occupiedUnits, vacantUnits, activeLeases, openWorkOrders, count(DISTINCT inv) AS overdueInvoices

      RETURN
        p._id AS propertyId,
        COALESCE(p.name, p._id) AS propertyName,
        totalUnits,
        occupiedUnits,
        vacantUnits,
        activeLeases,
        openWorkOrders,
        overdueInvoices,
        CASE WHEN totalUnits > 0 THEN toFloat(occupiedUnits) / totalUnits ELSE 0.0 END AS occupancyRate
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, propertyId });

    if (records.length === 0) {
      return {
        propertyId,
        propertyName: 'Unknown',
        totalUnits: 0,
        occupiedUnits: 0,
        vacantUnits: 0,
        activeLeases: 0,
        openWorkOrders: 0,
        overdueInvoices: 0,
        totalRevenue: 0,
        totalArrears: 0,
        avgSentiment: 0,
        occupancyRate: 0,
      };
    }

    const r = records[0]!;
    return {
      propertyId: String(r.propertyId),
      propertyName: String(r.propertyName ?? 'Unknown'),
      totalUnits: toNumber(r.totalUnits),
      occupiedUnits: toNumber(r.occupiedUnits),
      vacantUnits: toNumber(r.vacantUnits),
      activeLeases: toNumber(r.activeLeases),
      openWorkOrders: toNumber(r.openWorkOrders),
      overdueInvoices: toNumber(r.overdueInvoices),
      totalRevenue: 0,
      totalArrears: 0,
      avgSentiment: 0,
      occupancyRate: Math.round(toNumber(r.occupancyRate) * 100) / 100,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // G) Evidence Pack Generation — Assemble court-ready evidence for a case
  // ═══════════════════════════════════════════════════════════════════════════

  async generateEvidencePack(tenantId: string, caseId: string): Promise<EvidencePackResult> {
    const cypher = `
      MATCH (c:Case {_tenantId: $tenantId, _id: $caseId})

      // Direct connections
      OPTIONAL MATCH (c)-[r]-(connected)
      WHERE connected._tenantId = $tenantId

      WITH c, collect({
        nodeLabel: head(labels(connected)),
        nodeId: connected._id,
        timestamp: COALESCE(connected.occurredAt, connected.sentAt, connected.createdAt,
                           connected.processedAt, connected.attemptedAt),
        title: COALESCE(connected.title, connected.subject, connected.name,
                       connected.noticeNumber, connected.caseNumber, connected._id),
        type: COALESCE(connected.evidenceType, connected.noticeType, connected.caseType,
                      head(labels(connected))),
        properties: properties(connected),
        relationship: type(r)
      }) AS items

      RETURN
        c._id AS caseId,
        c.caseNumber AS caseNumber,
        c.title AS caseTitle,
        items
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId, caseId });

    if (records.length === 0) {
      return {
        caseId,
        caseNumber: '',
        caseTitle: '',
        generatedAt: new Date().toISOString(),
        totalItems: 0,
        items: [],
      };
    }

    const r = records[0]!;
    const rawItems = (r.items as Array<Record<string, unknown>>) ?? [];

    const items = rawItems
      .filter(item => item.nodeId != null)
      .map(item => ({
        nodeLabel: String(item.nodeLabel ?? ''),
        nodeId: String(item.nodeId ?? ''),
        timestamp: String(item.timestamp ?? ''),
        title: String(item.title ?? ''),
        type: String(item.type ?? ''),
        properties: (item.properties as Record<string, unknown>) ?? {},
        connectionPath: String(item.relationship ?? ''),
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      caseId,
      caseNumber: String(r.caseNumber ?? ''),
      caseTitle: String(r.caseTitle ?? ''),
      generatedAt: new Date().toISOString(),
      totalItems: items.length,
      items,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // H) Portfolio Overview — Multi-property rollup for an org
  // ═══════════════════════════════════════════════════════════════════════════

  async getPortfolioOverview(tenantId: string): Promise<PropertyRollup[]> {
    const cypher = `
      MATCH (p:Property {_tenantId: $tenantId})
      OPTIONAL MATCH (p)-[:HAS_UNIT]->(u:Unit {_tenantId: $tenantId})
      WITH p,
           count(u) AS totalUnits,
           size([u IN collect(u) WHERE u.status = 'occupied']) AS occupiedUnits,
           size([u IN collect(u) WHERE u.status = 'vacant']) AS vacantUnits

      RETURN
        p._id AS propertyId,
        COALESCE(p.name, p._id) AS propertyName,
        totalUnits,
        occupiedUnits,
        vacantUnits,
        CASE WHEN totalUnits > 0 THEN toFloat(occupiedUnits) / totalUnits ELSE 0.0 END AS occupancyRate
      ORDER BY propertyName
    `;

    const records = await this.client.readQuery<Record<string, unknown>>(cypher, { tenantId });

    return records.map(r => (r ? {
      propertyId: String(r.propertyId),
      propertyName: String(r.propertyName ?? 'Unknown'),
      totalUnits: toNumber(r.totalUnits),
      occupiedUnits: toNumber(r.occupiedUnits),
      vacantUnits: toNumber(r.vacantUnits),
      activeLeases: 0,
      openWorkOrders: 0,
      overdueInvoices: 0,
      totalRevenue: 0,
      totalArrears: 0,
      avgSentiment: 0,
      occupancyRate: Math.round(toNumber(r.occupancyRate) * 100) / 100,
    } : null)).filter((x): x is NonNullable<typeof x> => x != null);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // I) Graph Statistics — For monitoring and debugging
  // ═══════════════════════════════════════════════════════════════════════════

  async getGraphStats(tenantId: string): Promise<{
    nodeCount: Record<string, number>;
    relationshipCount: number;
    lastSyncedAt: string | null;
  }> {
    const nodeCountCypher = `
      MATCH (n {_tenantId: $tenantId})
      WITH labels(n) AS nodeLabels, n._syncedAt AS syncedAt
      UNWIND nodeLabels AS label
      RETURN label, count(*) AS cnt, max(syncedAt) AS lastSync
      ORDER BY cnt DESC
    `;

    const relCountCypher = `
      MATCH (a {_tenantId: $tenantId})-[r]->(b {_tenantId: $tenantId})
      RETURN count(r) AS total
    `;

    const [nodeRecords, relRecords] = await Promise.all([
      this.client.readQuery<{ label: string; cnt: { low: number } | number; lastSync: string }>(
        nodeCountCypher, { tenantId }
      ),
      this.client.readQuery<{ total: { low: number } | number }>(
        relCountCypher, { tenantId }
      ),
    ]);

    const nodeCount: Record<string, number> = {};
    let lastSyncedAt: string | null = null;
    for (const r of nodeRecords) {
      nodeCount[r.label] = typeof r.cnt === 'object' ? r.cnt.low : Number(r.cnt);
      if (r.lastSync && (!lastSyncedAt || r.lastSync > lastSyncedAt)) {
        lastSyncedAt = r.lastSync;
      }
    }

    const totalRels = relRecords[0]
      ? (typeof relRecords[0].total === 'object' ? relRecords[0].total.low : Number(relRecords[0].total))
      : 0;

    return { nodeCount, relationshipCount: totalRels, lastSyncedAt };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val !== null && 'low' in val) return (val as { low: number }).low;
  return Number(val) || 0;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createGraphQueryService(client: Neo4jClient): GraphQueryService {
  return new GraphQueryService(client);
}
