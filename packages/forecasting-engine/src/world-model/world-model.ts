/**
 * WorldModel — the persistent business state representation.
 *
 * Immutable snapshot of the org's dynamics: tenant graph, cashflow
 * state, compliance state, market cache, and the owner's archetype.
 * Every state transition returns a new model — never mutates in
 * place — so simulators can fork freely.
 */

import type {
  BusinessContext,
  TenantNode,
  UnitNode,
  OwnerIntent,
  TimePoint,
} from '../types.js';

export interface WorldModelState {
  readonly orgId: string;
  readonly tenants: ReadonlyArray<TenantNode>;
  readonly units: ReadonlyArray<UnitNode>;
  readonly cashBalance: number;
  readonly historicalCashflow: ReadonlyArray<TimePoint>;
  readonly ownerIntent: OwnerIntent;
  readonly nowMs: number;
  readonly version: number;
}

export class WorldModel {
  readonly state: WorldModelState;

  constructor(state: WorldModelState) {
    this.state = state;
  }

  static fromContext(ctx: BusinessContext): WorldModel {
    return new WorldModel({
      orgId: ctx.orgId,
      tenants: ctx.tenants,
      units: ctx.units,
      cashBalance: ctx.cashBalance,
      historicalCashflow: ctx.historicalCashflow,
      ownerIntent: ctx.ownerIntent,
      nowMs: ctx.nowMs,
      version: 0,
    });
  }

  withCashBalance(next: number): WorldModel {
    return new WorldModel({
      ...this.state,
      cashBalance: next,
      version: this.state.version + 1,
    });
  }

  withUnit(unitId: string, patch: Partial<UnitNode>): WorldModel {
    const units = this.state.units.map((u) =>
      u.unitId === unitId ? { ...u, ...patch } : u,
    );
    return new WorldModel({
      ...this.state,
      units,
      version: this.state.version + 1,
    });
  }

  withTenant(tenantId: string, patch: Partial<TenantNode>): WorldModel {
    const tenants = this.state.tenants.map((t) =>
      t.tenantId === tenantId ? { ...t, ...patch } : t,
    );
    return new WorldModel({
      ...this.state,
      tenants,
      version: this.state.version + 1,
    });
  }

  withCashflowAppend(point: TimePoint): WorldModel {
    return new WorldModel({
      ...this.state,
      historicalCashflow: [...this.state.historicalCashflow, point],
      version: this.state.version + 1,
    });
  }

  occupancyRate(): number {
    if (this.state.units.length === 0) return 0;
    const occupied = this.state.units.filter((u) => u.occupied).length;
    return occupied / this.state.units.length;
  }

  monthlyRentRoll(): number {
    return this.state.tenants.reduce((sum, t) => sum + t.monthlyRent, 0);
  }
}
