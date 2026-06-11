/**
 * Legacy-portal browser super-power route — the MD's "remote Chrome window".
 *
 * This is the reachability surface for the AXTree browser-driving capability
 * (`@borjie/browser-perception` + `composition/legacy-portal-bridge.ts`). It
 * lets Mr. Mwikila DRIVE a third-party web portal that has NO API — e.g. file a
 * KRA iTax monthly return — by PERCEIVING the page through its accessibility
 * tree (never raw DOM, ~93% fewer tokens) and acting via a structured
 * verb stream, with an AXTree-diff confirming every step.
 *
 * WHY THIS DOES NOT FAKE A FILING (no mock / no stub for no reason):
 * Driving a real government portal autonomously is a genuinely ops- AND
 * legally-gated act — it needs a hardened Playwright runtime in an isolated VPC,
 * an IP whitelisted on the regulator side, real tenant credentials from the
 * secret vault, an idempotency hash, and a retry budget (tracked as #33). We do
 * NOT simulate a successful filing when that infrastructure is absent. Instead
 * the composition root binds the REAL bridge function onto
 * `services.legacyPortalFileKra` ONLY when the environment is provisioned; when
 * it is not, this route returns an HONEST, structured "wired-and-governed but
 * not-provisioned" envelope. The capability is reachable and governed in every
 * environment; only the live external connection is provisioning-gated.
 *
 * GOVERNANCE: the call originates from the brain tool
 * `platform.legacy.file_kra_via_browser` (HIGH stakes, isWrite,
 * requiresPolicyRuleLiteral) so it flows through the autonomy gate + policy
 * rails + R7 shadow-certify before it ever reaches here.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';

/**
 * The real bridge function the composition root binds when the portal runtime
 * is provisioned. Mirrors `createKraFilingBridge(...)`'s return type without
 * importing it here (keeps the route free of the Playwright/bridge graph).
 */
export interface LegacyPortalControlCandidate {
  readonly role: string;
  readonly name: string;
  readonly score: number;
}

export interface LegacyPortalFileKra {
  (input: {
    readonly tenantId: string;
    readonly periodYearMonth: string;
    readonly monthlyRentalIncomeKes: number;
    readonly expensesKes?: number;
  }): Promise<{
    readonly ok: boolean;
    readonly filed: boolean;
    readonly confirmationText?: string;
    readonly failureReason?: string;
    /**
     * Halt-for-help signal — the driver loop hit a control ambiguity it
     * cannot resolve autonomously and is asking the brain to re-plan.
     * Surfaced as a 200 `action-requires-clarification` envelope, NOT an
     * error, so the brain re-plans mid-flow instead of failing the task.
     */
    readonly askBrain?: boolean;
    readonly candidates?: ReadonlyArray<LegacyPortalControlCandidate>;
    readonly idempotentReplay?: boolean;
    readonly steps: ReadonlyArray<{
      readonly verb: string;
      readonly ok: boolean;
      readonly reason?: string;
      readonly attempts?: number;
    }>;
  }>;
}

const FileKraInput = z.object({
  periodYearMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'periodYearMonth must be YYYY-MM'),
  monthlyRentalIncomeKes: z.number().nonnegative(),
  expensesKes: z.number().nonnegative().optional(),
});

export function createLegacyPortalRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.post('/file-kra', async (c: any) => {
    const auth = c.get('auth') ?? {};
    const tenantId = auth.tenantId as string | undefined;
    if (!tenantId) {
      return c.json(
        { success: false, error: { code: 'NO_TENANT', message: 'tenant scope required' } },
        401,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { success: false, error: { code: 'BAD_JSON', message: 'body must be JSON' } },
        400,
      );
    }
    const parsed = FileKraInput.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'BAD_INPUT', message: parsed.error.issues[0]?.message ?? 'invalid input' },
        },
        400,
      );
    }

    const services = (c.get('services') ?? {}) as {
      legacyPortalFileKra?: LegacyPortalFileKra;
    };
    const fileKra = services.legacyPortalFileKra;

    // HONEST not-provisioned degradation — never a faked filing, never a crash.
    if (!fileKra) {
      return c.json(
        {
          success: true,
          data: {
            ok: false,
            filed: false,
            provisioned: false,
            reason:
              'legacy-portal browser driving is wired + governed but NOT provisioned in ' +
              'this environment — it requires the hardened Playwright sandbox (isolated VPC, ' +
              'regulator IP allowlist, vault credentials, idempotency budget) tracked as ops #33. ' +
              'No filing was attempted and no data was fabricated.',
            steps: [],
          },
        },
        200,
      );
    }

    try {
      const outcome = await fileKra({
        tenantId,
        periodYearMonth: parsed.data.periodYearMonth,
        monthlyRentalIncomeKes: parsed.data.monthlyRentalIncomeKes,
        ...(parsed.data.expensesKes !== undefined
          ? { expensesKes: parsed.data.expensesKes }
          : {}),
      });

      // HALT-FOR-HELP — the driver loop hit a control ambiguity it can't
      // resolve autonomously. This is NOT an error: return an honest 200
      // clarification envelope so the brain re-plans mid-flow (picks a
      // candidate / re-asks the owner) instead of failing the whole task.
      if (outcome.askBrain) {
        return c.json(
          {
            success: true,
            data: {
              ...outcome,
              ok: false,
              filed: false,
              provisioned: true,
              reason: 'action-requires-clarification',
              askBrain: true,
              candidates: outcome.candidates ?? [],
            },
          },
          200,
        );
      }

      return c.json({ success: true, data: { ...outcome, provisioned: true } }, 200);
    } catch (err) {
      return c.json(
        {
          success: false,
          error: {
            code: 'LEGACY_PORTAL_DRIVE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        502,
      );
    }
  });

  return app;
}

export default createLegacyPortalRouter;
