/**
 * drafter-registry.test.ts — locks the `drafted` gating of the graded-corrective
 * drafter (Wave-C C3 WIN-3). The drafter writes a PROPOSE-ONLY draft row via a
 * conditional INSERT ... WHERE EXISTS(owner) AND NOT EXISTS(dedupe) RETURNING id;
 * it must report `drafted: true` ONLY when a row was actually written — never
 * when the owner FK is missing or a draft already exists (dedupe).
 */

import { describe, it, expect, vi } from 'vitest';

import { drafterFor } from '../drafter-registry';
import type { PinoLikeLogger } from '../../../utils/pino-shim';
import type {
  MwikilaHandler,
  MwikilaHandlerProposal,
} from '../../../services/mwikila-autonomy/handler-runtime';

const NOOP_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as PinoLikeLogger;

const PROPOSAL: MwikilaHandlerProposal = {
  actionKind: 'license_renewal',
  category: 'compliance',
  summary: 'Draft GL-44 renewal',
  summarySw: 'Andaa upya GL-44',
  rationale: 'Licence within renewal lead-time',
  payload: { licenceId: 'GL-44' },
} as unknown as MwikilaHandlerProposal;

const handlerWith = (
  propose: () => Promise<MwikilaHandlerProposal | null>,
): MwikilaHandler =>
  ({ actionKind: 'license_renewal', propose } as unknown as MwikilaHandler);

const COMMITMENT = { id: 'c1', tenantId: 't1', ownerId: 'u1' } as never;
const CTX = { tenantId: 't1', nowMs: 1_000, breachSeverity: 0.5 } as never;

describe('drafterFor — drafted gating', () => {
  it('reports drafted=true + draftRef when the conditional INSERT writes a row', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ id: 'row-1' }]) };
    const drafter = drafterFor(
      db,
      handlerWith(async () => PROPOSAL),
      NOOP_LOGGER,
    );
    const out = await drafter(COMMITMENT, CTX);
    expect(out.drafted).toBe(true);
    expect(out.draftRef).toBe('license_renewal:c1');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('reports drafted=false when the INSERT writes ZERO rows (missing owner / dedupe)', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };
    const drafter = drafterFor(
      db,
      handlerWith(async () => PROPOSAL),
      NOOP_LOGGER,
    );
    const out = await drafter(COMMITMENT, CTX);
    expect(out.drafted).toBe(false);
    expect(out.draftRef).toBeUndefined();
  });

  it('handles the pg `{ rows }` driver shape', async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [{ id: 'row-1' }] }) };
    const drafter = drafterFor(
      db,
      handlerWith(async () => PROPOSAL),
      NOOP_LOGGER,
    );
    expect((await drafter(COMMITMENT, CTX)).drafted).toBe(true);
  });

  it('reports drafted=false (no DB write) when the handler has no actionable proposal', async () => {
    const db = { execute: vi.fn() };
    const drafter = drafterFor(
      db,
      handlerWith(async () => null),
      NOOP_LOGGER,
    );
    expect((await drafter(COMMITMENT, CTX)).drafted).toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('honest-degrades to drafted=false when the handler propose() throws', async () => {
    const db = { execute: vi.fn() };
    const drafter = drafterFor(
      db,
      handlerWith(async () => {
        throw new Error('port outage');
      }),
      NOOP_LOGGER,
    );
    expect((await drafter(COMMITMENT, CTX)).drafted).toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
