/**
 * LIVE-PATH admission contract.
 *
 * Boots the REAL gateway composition (`buildPortalGenuiWiring`) and asserts that
 * a tab violating locale-purity or chart-truth is actually REJECTED by the
 * engine's persist chokepoint with `TAB_ADMISSION_FAILED` (the code the router
 * maps to 422). This closes the documented "rule exists in the registry ≠ rule
 * enforces in production" false-green class (CLOSE-G): the admission registry
 * advertises six rules, but for a long time the composition root passed ONLY
 * `urlEgressPolicy`, leaving `locale-purity`, `evidence-presence`, and
 * `chart-truth` as silent live no-ops. If anyone re-introduces that regression,
 * THIS test goes red — a registry membership test never could.
 */

import { describe, expect, it } from 'vitest';
import type { GenUIEngine, PortalTab } from '@borjie/portal-genui';
import { buildPortalGenuiWiring } from '../portal-genui-wiring.js';

async function baseTab(engine: GenUIEngine): Promise<PortalTab> {
  const intent = await engine.detectIntent({
    message: 'we need to track our staff payroll',
  });
  if (!intent) throw new Error('test setup: intent not detected');
  const out = await engine.generate({
    intent,
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
  });
  return out.tab;
}

describe('genui LIVE-PATH admission enforcement', () => {
  it('the real composition enforces locale-purity, not just url-egress', async () => {
    const { engine } = buildPortalGenuiWiring();
    const base = await baseTab(engine);

    // English headers + a Swahili section title ⇒ the tab MIXES en + sw, which
    // the absolute zero-mixing law forbids. The real composition wires a live
    // locale detector, so this must be rejected.
    const mixed: PortalTab = {
      ...base,
      title: 'Employee payroll report',
      description: 'View the total amount for your staff this month',
      sections: base.sections.map((s, i) =>
        i === 0 ? { ...s, title: 'Malipo ya wafanyakazi kwa mwezi' } : s,
      ),
    };

    await expect(engine.persist({ tab: mixed })).rejects.toMatchObject({
      code: 'TAB_ADMISSION_FAILED',
      violations: expect.arrayContaining([
        expect.objectContaining({ rule: 'locale-purity' }),
      ]),
    });
  });

  it('the real composition enforces chart-truth (the lying-chart detector is live)', async () => {
    const { engine } = buildPortalGenuiWiring();
    const base = await baseTab(engine);

    // A bar chart whose series has FEWER values than there are categories ⇒ the
    // bars would be mislabeled (a lying chart). `checkChartTruth` — dead until
    // now — must fire at admission.
    const lying: PortalTab = {
      ...base,
      tabKey: 'hr-chart-liar',
      sections: base.sections.map((s, i) =>
        i === 0
          ? {
              ...s,
              widgets: [
                ...s.widgets,
                {
                  key: 'w_liar',
                  kind: 'chart_bar',
                  title: 'Quarterly revenue',
                  config: {
                    categories: ['Q1', 'Q2', 'Q3'],
                    series: [{ name: 'Revenue', values: [120, 140] }],
                  },
                },
              ],
            }
          : s,
      ),
    } as PortalTab;

    await expect(engine.persist({ tab: lying })).rejects.toMatchObject({
      code: 'TAB_ADMISSION_FAILED',
      violations: expect.arrayContaining([
        expect.objectContaining({ rule: 'chart-truth' }),
      ]),
    });
  });

  it('still admits a clean single-language tab (no false-blocking)', async () => {
    const { engine } = buildPortalGenuiWiring();
    const base = await baseTab(engine);
    const saved = await engine.persist({ tab: base });
    expect(saved.id).toBeTruthy();
  });
});
