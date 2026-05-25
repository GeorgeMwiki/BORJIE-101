/**
 * ComplianceState — minimal state machine for compliance windows.
 *
 * Tracks open filings (KRA, council, regulator) and their deadlines.
 * Returns new instances on every transition.
 */

export type FilingKind = 'KRA-VAT' | 'KRA-MRI' | 'KRA-WHT' | 'COUNCIL-LAND' | 'CUSTOM';

export interface Filing {
  readonly id: string;
  readonly kind: FilingKind;
  readonly dueAt: number; // ms
  readonly status: 'open' | 'submitted' | 'overdue';
  readonly readiness: number; // 0..1
}

export interface ComplianceStateSnapshot {
  readonly filings: ReadonlyArray<Filing>;
  readonly violations: number;
}

export class ComplianceState {
  readonly snapshot: ComplianceStateSnapshot;

  constructor(snapshot: ComplianceStateSnapshot) {
    this.snapshot = snapshot;
  }

  static initial(filings: ReadonlyArray<Filing> = []): ComplianceState {
    return new ComplianceState({ filings, violations: 0 });
  }

  markSubmitted(filingId: string): ComplianceState {
    const filings = this.snapshot.filings.map((f) =>
      f.id === filingId ? { ...f, status: 'submitted' as const, readiness: 1 } : f,
    );
    return new ComplianceState({ ...this.snapshot, filings });
  }

  advanceTo(nowMs: number): ComplianceState {
    let violations = this.snapshot.violations;
    const filings = this.snapshot.filings.map((f) => {
      if (f.status === 'submitted') return f;
      if (nowMs > f.dueAt && f.status !== 'overdue') {
        violations += 1;
        return { ...f, status: 'overdue' as const };
      }
      return f;
    });
    return new ComplianceState({ filings, violations });
  }

  complianceScore(): number {
    if (this.snapshot.filings.length === 0) return 1;
    const open = this.snapshot.filings.filter((f) => f.status !== 'submitted');
    if (open.length === 0) return 1;
    const avgReadiness =
      open.reduce((s, f) => s + f.readiness, 0) / open.length;
    const violationPenalty = Math.min(1, this.snapshot.violations * 0.25);
    return Math.max(0, avgReadiness - violationPenalty);
  }
}
