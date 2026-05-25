/**
 * CashflowState — minimal state machine for in-simulation cash.
 *
 * Tracks running balance, projected inflows, and projected
 * outflows. Returns new instances on every step.
 */

export interface CashflowEvent {
  readonly t: number; // ms
  readonly amount: number; // signed: positive = inflow
  readonly kind: 'rent' | 'expense' | 'vendor' | 'tax' | 'other';
  readonly note?: string;
}

export interface CashflowStateSnapshot {
  readonly balance: number;
  readonly events: ReadonlyArray<CashflowEvent>;
  readonly negativeDays: number;
  readonly minBalance: number;
}

export class CashflowState {
  readonly snapshot: CashflowStateSnapshot;

  constructor(snapshot: CashflowStateSnapshot) {
    this.snapshot = snapshot;
  }

  static initial(balance: number): CashflowState {
    return new CashflowState({
      balance,
      events: [],
      negativeDays: 0,
      minBalance: balance,
    });
  }

  apply(event: CashflowEvent): CashflowState {
    const nextBalance = this.snapshot.balance + event.amount;
    const wentNegative = nextBalance < 0 && this.snapshot.balance >= 0;
    return new CashflowState({
      balance: nextBalance,
      events: [...this.snapshot.events, event],
      negativeDays: this.snapshot.negativeDays + (wentNegative ? 1 : 0),
      minBalance: Math.min(this.snapshot.minBalance, nextBalance),
    });
  }

  applyMany(events: ReadonlyArray<CashflowEvent>): CashflowState {
    return events.reduce<CashflowState>((acc, ev) => acc.apply(ev), this);
  }

  shortfallProbability(threshold = 0): number {
    if (this.snapshot.events.length === 0) return 0;
    const dipped = this.snapshot.minBalance < threshold ? 1 : 0;
    return dipped;
  }
}
