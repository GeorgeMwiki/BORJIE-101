/**
 * ID Generator utilities
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  DocumentId,
  IdentityProfileId,
  VerificationBadgeId,
  FraudRiskScoreId,
  EvidencePackId,
  ExpiryTrackerId,
  ValidationResultId,
} from '../types/index.js';

export function generateDocumentId(): DocumentId {
  return `doc_${uuidv4()}` as DocumentId;
}

export function generateIdentityProfileId(): IdentityProfileId {
  return `idp_${uuidv4()}` as IdentityProfileId;
}

export function generateVerificationBadgeId(): VerificationBadgeId {
  return `badge_${uuidv4()}` as VerificationBadgeId;
}

export function generateFraudRiskScoreId(): FraudRiskScoreId {
  return `frs_${uuidv4()}` as FraudRiskScoreId;
}

export function generateEvidencePackId(): EvidencePackId {
  return `evp_${uuidv4()}` as EvidencePackId;
}

export function generateExpiryTrackerId(): ExpiryTrackerId {
  return `exp_${uuidv4()}` as ExpiryTrackerId;
}

export function generateValidationResultId(): ValidationResultId {
  return `val_${uuidv4()}` as ValidationResultId;
}

export function generateOCRExtractionId(): string {
  return `ocr_${uuidv4()}`;
}

export function generateChecksum(content: Buffer | string): string {
  // Using a simple hash for demonstration
  // In production, use crypto.createHash('sha256')
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content).digest('hex');
}
