/**
 * Rent-Credit-Building shared types.
 */

export interface PaymentRecord {
  readonly tenantId: string;
  readonly leaseId: string;
  readonly userId: string;
  readonly dueDate: string;
  readonly paidAt?: string;
  readonly amountExpected: number;
  readonly amountPaid: number;
  readonly currency: 'KES' | 'TZS' | 'UGX' | 'RWF';
  readonly method: 'mpesa' | 'azam' | 'gepg' | 'bank' | 'cash' | 'other';
}

export interface RentCreditScore {
  readonly userId: string;
  readonly tenantId: string;
  readonly score: number;
  readonly grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  readonly onTimeRatePct: number;
  readonly averageDaysLate: number;
  readonly totalPaymentsEvaluated: number;
  readonly consecutiveOnTimeStreak: number;
  readonly monthsObserved: number;
  readonly calculatedAt: string;
  readonly recommendations: readonly string[];
}

export interface ScoreReport {
  readonly userId: string;
  readonly tenantId: string;
  readonly score: RentCreditScore;
  readonly narrativeEn: string;
  readonly narrativeSw: string;
  readonly generatedAt: string;
  readonly reportId: string;
}

export interface FinancingPartner {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly productType: 'savings' | 'micro-loan' | 'deposit-finance' | 'rent-to-own';
  readonly minScoreRequired: number;
  readonly notesEn: string;
  readonly notesSw: string;
  readonly contactUrl?: string;
}
