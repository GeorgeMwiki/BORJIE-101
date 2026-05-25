/**
 * SOC 2 Type II Compliance Controls
 * 
 * Implements controls aligned with AICPA Trust Service Criteria:
 * - CC (Common Criteria) - Security, Availability, Processing Integrity, Confidentiality, Privacy
 * - Implementation of control activities, monitoring, and evidence collection
 */

import { z } from 'zod';

/**
 * SOC 2 Trust Service Categories
 */
export const SOC2Category = {
  SECURITY: 'SECURITY',
  AVAILABILITY: 'AVAILABILITY',
  PROCESSING_INTEGRITY: 'PROCESSING_INTEGRITY',
  CONFIDENTIALITY: 'CONFIDENTIALITY',
  PRIVACY: 'PRIVACY',
} as const;

export type SOC2Category = typeof SOC2Category[keyof typeof SOC2Category];

/**
 * Control Status
 */
export const ControlStatus = {
  COMPLIANT: 'COMPLIANT',
  NON_COMPLIANT: 'NON_COMPLIANT',
  PARTIALLY_COMPLIANT: 'PARTIALLY_COMPLIANT',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNDER_REVIEW: 'UNDER_REVIEW',
} as const;

export type ControlStatus = typeof ControlStatus[keyof typeof ControlStatus];

/**
 * Evidence Type for control validation
 */
export const EvidenceType = {
  AUTOMATED_TEST: 'AUTOMATED_TEST',
  CONFIGURATION_SNAPSHOT: 'CONFIGURATION_SNAPSHOT',
  LOG_SAMPLE: 'LOG_SAMPLE',
  POLICY_DOCUMENT: 'POLICY_DOCUMENT',
  MANUAL_ATTESTATION: 'MANUAL_ATTESTATION',
  SCREENSHOT: 'SCREENSHOT',
  THIRD_PARTY_REPORT: 'THIRD_PARTY_REPORT',
} as const;

export type EvidenceType = typeof EvidenceType[keyof typeof EvidenceType];

/**
 * SOC 2 Control Definition
 */
export interface SOC2ControlDefinition {
  readonly id: string;
  readonly category: SOC2Category;
  readonly criteriaReference: string; // e.g., "CC6.1", "CC7.2"
  readonly title: string;
  readonly description: string;
  readonly implementationGuidance: string;
  readonly testProcedure: string;
  readonly evidenceTypes: readonly EvidenceType[];
  readonly frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  readonly automatable: boolean;
}

/**
 * Control Evidence Record
 */
export interface ControlEvidence {
  readonly id: string;
  readonly controlId: string;
  readonly type: EvidenceType;
  readonly collectedAt: string;
  readonly collectedBy: string;
  readonly description: string;
  readonly artifactPath?: string;
  readonly validUntil?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Control Assessment Result
 */
export interface ControlAssessment {
  readonly controlId: string;
  readonly assessedAt: string;
  readonly assessedBy: string;
  readonly status: ControlStatus;
  readonly findings: string[];
  readonly evidence: readonly ControlEvidence[];
  readonly remediationPlan?: string;
  readonly remediationDueDate?: string;
}

/**
 * SOC 2 Control Registry - Pre-defined controls mapped to BORJIE operations
 */
export const SOC2ControlRegistry: Record<string, SOC2ControlDefinition> = {
  // Security Controls (CC6)
  'CC6.1-ACCESS-CONTROL': {
    id: 'CC6.1-ACCESS-CONTROL',
    category: SOC2Category.SECURITY,
    criteriaReference: 'CC6.1',
    title: 'Logical Access Security',
    description: 'The entity implements logical access security software, infrastructure, and architectures to protect information assets.',
    implementationGuidance: 'Implement RBAC with tenant isolation, enforce strong authentication, and maintain access logs.',
    testProcedure: 'Verify that all API endpoints enforce authentication and authorization, test tenant isolation boundaries.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.CONFIGURATION_SNAPSHOT, EvidenceType.LOG_SAMPLE],
    frequency: 'continuous',
    automatable: true,
  },
  'CC6.2-USER-REGISTRATION': {
    id: 'CC6.2-USER-REGISTRATION',
    category: SOC2Category.SECURITY,
    criteriaReference: 'CC6.2',
    title: 'User Registration and Authorization',
    description: 'Prior to issuing system credentials and granting system access, the entity registers and authorizes new internal and external users.',
    implementationGuidance: 'Implement user provisioning workflow with approval, email verification, and role assignment.',
    testProcedure: 'Review user registration process, verify approval workflows, check for unauthorized access attempts.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.LOG_SAMPLE, EvidenceType.POLICY_DOCUMENT],
    frequency: 'continuous',
    automatable: true,
  },
  'CC6.3-USER-DEPROVISIONING': {
    id: 'CC6.3-USER-DEPROVISIONING',
    category: SOC2Category.SECURITY,
    criteriaReference: 'CC6.3',
    title: 'User Deprovisioning',
    description: 'The entity removes system access when it is no longer needed.',
    implementationGuidance: 'Implement user deactivation workflow, session termination, and access revocation.',
    testProcedure: 'Verify deactivated users cannot access system, check for orphaned sessions.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.LOG_SAMPLE],
    frequency: 'daily',
    automatable: true,
  },
  'CC6.6-ENCRYPTION-AT-REST': {
    id: 'CC6.6-ENCRYPTION-AT-REST',
    category: SOC2Category.SECURITY,
    criteriaReference: 'CC6.6',
    title: 'Encryption at Rest',
    description: 'The entity implements encryption to protect data at rest.',
    implementationGuidance: 'Encrypt all PII and sensitive financial data in database, use AES-256 encryption for file storage.',
    testProcedure: 'Verify encryption configuration on databases and storage, check key management procedures.',
    evidenceTypes: [EvidenceType.CONFIGURATION_SNAPSHOT, EvidenceType.POLICY_DOCUMENT],
    frequency: 'quarterly',
    automatable: true,
  },
  'CC6.7-ENCRYPTION-IN-TRANSIT': {
    id: 'CC6.7-ENCRYPTION-IN-TRANSIT',
    category: SOC2Category.SECURITY,
    criteriaReference: 'CC6.7',
    title: 'Encryption in Transit',
    description: 'The entity restricts transmission, movement, and removal of information to authorized external parties and protects it during transmission.',
    implementationGuidance: 'Enforce TLS 1.3 for all API communications, use mTLS for service-to-service communication.',
    testProcedure: 'Test TLS configuration, verify no plaintext transmission of sensitive data.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.CONFIGURATION_SNAPSHOT],
    frequency: 'weekly',
    automatable: true,
  },

  // Availability Controls (CC7)
  'CC7.1-SYSTEM-MONITORING': {
    id: 'CC7.1-SYSTEM-MONITORING',
    category: SOC2Category.AVAILABILITY,
    criteriaReference: 'CC7.1',
    title: 'System Monitoring and Incident Detection',
    description: 'The entity detects, monitors, and remediates system anomalies, incidents, and vulnerabilities.',
    implementationGuidance: 'Implement comprehensive observability with metrics, logs, and traces; set up alerting for anomalies.',
    testProcedure: 'Review monitoring coverage, test alert triggering, verify incident response procedures.',
    evidenceTypes: [EvidenceType.CONFIGURATION_SNAPSHOT, EvidenceType.LOG_SAMPLE, EvidenceType.POLICY_DOCUMENT],
    frequency: 'continuous',
    automatable: true,
  },
  'CC7.2-INCIDENT-RESPONSE': {
    id: 'CC7.2-INCIDENT-RESPONSE',
    category: SOC2Category.AVAILABILITY,
    criteriaReference: 'CC7.2',
    title: 'Incident Response',
    description: 'The entity responds to identified security incidents by executing defined procedures.',
    implementationGuidance: 'Maintain incident response playbooks, establish on-call rotation, document incident handling.',
    testProcedure: 'Review incident tickets, verify response times, test escalation procedures.',
    evidenceTypes: [EvidenceType.POLICY_DOCUMENT, EvidenceType.LOG_SAMPLE, EvidenceType.MANUAL_ATTESTATION],
    frequency: 'monthly',
    automatable: false,
  },
  'CC7.4-BACKUP-RECOVERY': {
    id: 'CC7.4-BACKUP-RECOVERY',
    category: SOC2Category.AVAILABILITY,
    criteriaReference: 'CC7.4',
    title: 'Backup and Recovery',
    description: 'The entity maintains backup copies of data and tests restoration procedures.',
    implementationGuidance: 'Implement automated backups with point-in-time recovery, test restoration quarterly.',
    testProcedure: 'Verify backup completion logs, test restoration to isolated environment, measure RTO/RPO.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.LOG_SAMPLE, EvidenceType.MANUAL_ATTESTATION],
    frequency: 'quarterly',
    automatable: true,
  },

  // Processing Integrity Controls (CC8)
  'CC8.1-PROCESSING-VALIDATION': {
    id: 'CC8.1-PROCESSING-VALIDATION',
    category: SOC2Category.PROCESSING_INTEGRITY,
    criteriaReference: 'CC8.1',
    title: 'Processing Validation',
    description: 'The entity validates inputs and outputs to ensure processing integrity.',
    implementationGuidance: 'Implement input validation schemas, output checksums for financial data, reconciliation jobs.',
    testProcedure: 'Test input validation, verify ledger reconciliation, check financial calculation accuracy.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.LOG_SAMPLE],
    frequency: 'continuous',
    automatable: true,
  },

  // Confidentiality Controls (CC9)
  'CC9.1-CONFIDENTIALITY-CLASSIFICATION': {
    id: 'CC9.1-CONFIDENTIALITY-CLASSIFICATION',
    category: SOC2Category.CONFIDENTIALITY,
    criteriaReference: 'CC9.1',
    title: 'Data Classification',
    description: 'The entity identifies and classifies confidential information.',
    implementationGuidance: 'Implement data classification schema, tag sensitive fields in database, enforce access based on classification.',
    testProcedure: 'Review data classification inventory, verify access controls match classification levels.',
    evidenceTypes: [EvidenceType.POLICY_DOCUMENT, EvidenceType.CONFIGURATION_SNAPSHOT],
    frequency: 'quarterly',
    automatable: true,
  },

  // Privacy Controls (P)
  'P1-PRIVACY-NOTICE': {
    id: 'P1-PRIVACY-NOTICE',
    category: SOC2Category.PRIVACY,
    criteriaReference: 'P1',
    title: 'Privacy Notice',
    description: 'The entity provides notice to data subjects about its privacy practices.',
    implementationGuidance: 'Maintain up-to-date privacy policy, present at registration, track consent.',
    testProcedure: 'Review privacy policy content, verify presentation in user flows, check consent records.',
    evidenceTypes: [EvidenceType.POLICY_DOCUMENT, EvidenceType.SCREENSHOT, EvidenceType.LOG_SAMPLE],
    frequency: 'quarterly',
    automatable: false,
  },
  'P4-DATA-SUBJECT-RIGHTS': {
    id: 'P4-DATA-SUBJECT-RIGHTS',
    category: SOC2Category.PRIVACY,
    criteriaReference: 'P4',
    title: 'Data Subject Rights',
    description: 'The entity provides data subjects with access to their data and the ability to correct, delete, or restrict processing.',
    implementationGuidance: 'Implement data export, deletion request workflow, and consent management features.',
    testProcedure: 'Test data export functionality, verify deletion completeness, review consent management.',
    evidenceTypes: [EvidenceType.AUTOMATED_TEST, EvidenceType.LOG_SAMPLE],
    frequency: 'monthly',
    automatable: true,
  },
};

/**
 * SOC 2 Compliance Manager
 * Orchestrates control validation, evidence collection, and compliance reporting
 */
export class SOC2ComplianceManager {
  private assessments: Map<string, ControlAssessment> = new Map();
  private evidence: Map<string, ControlEvidence[]> = new Map();

  constructor(
    private readonly controlRegistry: Record<string, SOC2ControlDefinition> = SOC2ControlRegistry
  ) {}

  /**
   * Get all controls for a specific category
   */
  getControlsByCategory(category: SOC2Category): SOC2ControlDefinition[] {
    return Object.values(this.controlRegistry).filter(c => c.category === category);
  }

  /**
   * Get all automatable controls
   */
  getAutomatableControls(): SOC2ControlDefinition[] {
    return Object.values(this.controlRegistry).filter(c => c.automatable);
  }

  /**
   * Record evidence for a control
   */
  recordEvidence(evidence: ControlEvidence): void {
    const existing = this.evidence.get(evidence.controlId) ?? [];
    this.evidence.set(evidence.controlId, [...existing, evidence]);
  }

  /**
   * Record an assessment result
   */
  recordAssessment(assessment: ControlAssessment): void {
    this.assessments.set(assessment.controlId, assessment);
  }

  /**
   * Get compliance status summary
   */
  getComplianceSummary(): {
    totalControls: number;
    compliant: number;
    nonCompliant: number;
    partiallyCompliant: number;
    notAssessed: number;
    compliancePercentage: number;
  } {
    const controls = Object.values(this.controlRegistry);
    const totalControls = controls.length;
    
    let compliant = 0;
    let nonCompliant = 0;
    let partiallyCompliant = 0;
    let notAssessed = 0;

    for (const control of controls) {
      const assessment = this.assessments.get(control.id);
      if (!assessment) {
        notAssessed++;
      } else {
        switch (assessment.status) {
          case ControlStatus.COMPLIANT:
            compliant++;
            break;
          case ControlStatus.NON_COMPLIANT:
            nonCompliant++;
            break;
          case ControlStatus.PARTIALLY_COMPLIANT:
            partiallyCompliant++;
            break;
          default:
            notAssessed++;
        }
      }
    }

    const assessed = totalControls - notAssessed;
    const compliancePercentage = assessed > 0 
      ? Math.round((compliant / assessed) * 100)
      : 0;

    return {
      totalControls,
      compliant,
      nonCompliant,
      partiallyCompliant,
      notAssessed,
      compliancePercentage,
    };
  }

  /**
   * Get controls requiring attention (non-compliant or overdue for assessment)
   */
  getControlsRequiringAttention(): {
    nonCompliant: SOC2ControlDefinition[];
    overdue: SOC2ControlDefinition[];
  } {
    const now = new Date();
    const nonCompliant: SOC2ControlDefinition[] = [];
    const overdue: SOC2ControlDefinition[] = [];

    for (const control of Object.values(this.controlRegistry)) {
      const assessment = this.assessments.get(control.id);
      
      if (assessment?.status === ControlStatus.NON_COMPLIANT) {
        nonCompliant.push(control);
      }

      if (!assessment) {
        overdue.push(control);
      } else {
        const lastAssessed = new Date(assessment.assessedAt);
        const daysSinceAssessment = Math.floor(
          (now.getTime() - lastAssessed.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        const maxDays = this.getMaxDaysForFrequency(control.frequency);
        if (daysSinceAssessment > maxDays) {
          overdue.push(control);
        }
      }
    }

    return { nonCompliant, overdue };
  }

  private getMaxDaysForFrequency(frequency: SOC2ControlDefinition['frequency']): number {
    switch (frequency) {
      case 'continuous':
        return 1;
      case 'daily':
        return 1;
      case 'weekly':
        return 7;
      case 'monthly':
        return 30;
      case 'quarterly':
        return 90;
      case 'annual':
        return 365;
    }
  }

  /**
   * Generate compliance report for auditors
   */
  generateComplianceReport(): {
    generatedAt: string;
    summary: {
      totalControls: number;
      compliant: number;
      nonCompliant: number;
      partiallyCompliant: number;
      notAssessed: number;
      compliancePercentage: number;
    };
    controlDetails: Array<{
      control: SOC2ControlDefinition;
      assessment?: ControlAssessment;
      evidenceCount: number;
    }>;
  } {
    const controlDetails = Object.values(this.controlRegistry).map(control => ({
      control,
      assessment: this.assessments.get(control.id),
      evidenceCount: this.evidence.get(control.id)?.length ?? 0,
    }));

    return {
      generatedAt: new Date().toISOString(),
      summary: this.getComplianceSummary(),
      controlDetails,
    };
  }
}

/**
 * Zod schema for validating control evidence submissions
 */
export const ControlEvidenceSchema = z.object({
  id: z.string().uuid(),
  controlId: z.string(),
  type: z.nativeEnum(EvidenceType),
  collectedAt: z.string().datetime(),
  collectedBy: z.string(),
  description: z.string().min(10).max(1000),
  artifactPath: z.string().optional(),
  validUntil: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});
