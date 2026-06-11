/**
 * workforce-degraded-deps.ts — the db===null DEGRADED twins of the workforce
 * adapters (extracted from workforce-deps-wiring.ts to keep each file <800).
 *
 * When the composition root has no database client, `createWorkforceDeps`
 * still returns a COMPLETE, fail-safe `WorkforceDeps` so boot never crashes:
 * every store method is a safe no-op (returns empty/null + a one-time warn),
 * the audit + ticket adapters return a synthetic id and log. Nothing here ever
 * throws and nothing reaches a rail — these are the honest-degrade no-ops.
 */

import type {
  AuditChain,
  Employee,
  TicketCreator,
  WorkforceStore,
} from '@borjie/workforce-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

/** A WorkforceStore where every method is a safe no-op (no db bound). */
export function createDegradedStore(logger: PinoLikeLogger): WorkforceStore {
  const note = (m: string): void =>
    logger.warn(
      { method: m, organ: 'workforce-store' },
      'workforce-store: DEGRADED (no db) — no-op',
    );
  const passEmployee = async (row: Employee): Promise<Employee> => {
    note('insertEmployee');
    return row;
  };
  return {
    insertEmployee: passEmployee,
    async getEmployee() {
      note('getEmployee');
      return null;
    },
    async listEmployeesForManager() {
      return [];
    },
    async insertAssignment(row) {
      note('insertAssignment');
      return row;
    },
    async getAssignment() {
      return null;
    },
    async updateAssignment(row) {
      return row;
    },
    async listOverdueAssignments() {
      return [];
    },
    async listBlockedAssignments() {
      return [];
    },
    async listAssignmentsForEmployee() {
      return [];
    },
    async insertFollowup(row) {
      return row;
    },
    async updateFollowup(row) {
      return row;
    },
    async listDueFollowups() {
      return [];
    },
    async listFollowupsForAssignment() {
      return [];
    },
    async insertCheckIn(row) {
      return row;
    },
    async updateCheckIn(row) {
      return row;
    },
    async listCheckInsForAssignment() {
      return [];
    },
    async listCheckInsForEmployee() {
      return [];
    },
    async insertSignal(row) {
      return row;
    },
    async listSignalsForEmployee() {
      return [];
    },
    async insertAdvisoryBrief(row) {
      return row;
    },
    async latestAdvisoryBrief() {
      return null;
    },
    async upsertSkillAssessment(row) {
      return row;
    },
    async listSkillsForEmployee() {
      return [];
    },
    async insertCoachingPrompt(row) {
      return row;
    },
    async updateCoachingPrompt(row) {
      return row;
    },
    async listPendingCoachingPrompts() {
      return [];
    },
    async upsertKpi(row) {
      return row;
    },
    async getKpiForDay() {
      return null;
    },
  };
}

/** A degraded AuditChain — synthetic chainId, never persisted. */
export function createDegradedAudit(
  logger: PinoLikeLogger,
  uuid: () => string,
): AuditChain {
  return {
    async append(entry) {
      logger.warn(
        { tenantId: entry.tenantId, action: entry.action },
        'workforce-audit: DEGRADED (no db) — synthetic chainId, not persisted',
      );
      return { chainId: uuid() };
    },
  };
}

/** A degraded TicketCreator — synthetic ticketId, never persisted. */
export function createDegradedTickets(
  logger: PinoLikeLogger,
  uuid: () => string,
): TicketCreator {
  return {
    async createTicket(input) {
      logger.warn(
        { tenantId: input.tenantId },
        'workforce-tickets: DEGRADED (no db) — synthetic ticketId, not persisted',
      );
      return { ticketId: uuid() };
    },
  };
}
