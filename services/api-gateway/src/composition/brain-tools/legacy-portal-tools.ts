/**
 * Legacy-portal browser super-power — the MD's "remote Chrome window" exposed
 * as a governed brain tool.
 *
 * Mr. Mwikila can DRIVE a third-party web portal that has NO API (e.g. file a
 * KRA iTax monthly rental return) by perceiving the page through its
 * accessibility tree (`@borjie/browser-perception`, ~93% fewer tokens than raw
 * DOM) and acting via a structured verb stream confirmed by AXTree diffs. The
 * tool defers to `POST /mining/legacy-portal/file-kra` (loopback), where the
 * real `createKraFilingBridge` runs when the hardened Playwright runtime is
 * provisioned, and degrades honestly (never a faked filing) when it is not.
 *
 * GOVERNANCE: HIGH stakes + isWrite + requiresPolicyRuleLiteral — driving an
 * external regulator portal and submitting a return is a high-risk write, so it
 * must hit literal policy rules (no reason-resolver generalisation) and flows
 * through the autonomy gate + inviolable rails + R7 shadow-certify before the
 * route is ever reached. This is the canonical example of governance ENABLING a
 * frontier capability under proof, not gating it off.
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

const FileKraInput = z.object({
  periodYearMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .describe('Filing period as YYYY-MM, e.g. "2026-05".'),
  monthlyRentalIncomeKes: z
    .number()
    .nonnegative()
    .describe('Gross monthly rental income for the period, in KES.'),
  expensesKes: z
    .number()
    .nonnegative()
    .optional()
    .describe('Allowable expenses for the period, in KES (optional).'),
});

const FileKraOutput = z.object({
  ok: z.boolean(),
  filed: z.boolean(),
  provisioned: z.boolean(),
  reason: z.string().optional(),
  confirmationText: z.string().optional(),
  steps: z.array(
    z.object({ verb: z.string(), ok: z.boolean(), reason: z.string().optional() }),
  ),
});

export const fileKraViaBrowserTool: PersonaToolDescriptor<
  typeof FileKraInput,
  typeof FileKraOutput
> = {
  id: 'platform.legacy.file_kra_via_browser',
  name: 'File KRA iTax return via the browser',
  description:
    'Drive the KRA iTax portal in a headless browser to file a monthly rental ' +
    'return when no API exists. Perceives the page via its accessibility tree ' +
    'and confirms each step with an AXTree diff. HIGH-risk: submits a real ' +
    'regulator filing — requires authorization. Returns provisioned=false ' +
    '(no filing attempted) when the hardened portal runtime is not configured.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: FileKraInput,
  outputSchema: FileKraOutput,
  stakes: 'HIGH',
  isWrite: true,
  // HIGH-risk policy prefix — submitting an external regulator filing must hit
  // literal policy rules; no reason-resolver generalisation (CLAUDE.md).
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('platform.legacy.file_kra_via_browser requires httpClient');
    }
    return client.post<{
      ok: boolean;
      filed: boolean;
      provisioned: boolean;
      reason?: string;
      confirmationText?: string;
      steps: Array<{ verb: string; ok: boolean; reason?: string }>;
    }>('/mining/legacy-portal/file-kra', {
      periodYearMonth: input.periodYearMonth,
      monthlyRentalIncomeKes: input.monthlyRentalIncomeKes,
      ...(input.expensesKes !== undefined ? { expensesKes: input.expensesKes } : {}),
    });
  },
};

export const LEGACY_PORTAL_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  fileKraViaBrowserTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
