'use client';

/**
 * Estate metric strip — live KPI tile set for the estate overview page.
 *
 * Fans out to four estate aggregate endpoints in parallel (each with its
 * own independent loading / error state) so a slow or failing endpoint
 * does not block the others:
 *
 *   GET /api/v1/estate/groups          → entity count (sum of entity counts per group)
 *   GET /api/v1/estate/assets          → total asset value TZS
 *   GET /api/v1/estate/capital-movements?limit=200&since=<30d ago>
 *                                      → 30-day net capital flow TZS
 *   GET /api/v1/estate/succession-plans → succession plan status summary
 *
 * Each tile shows '—' when its source is loading and a muted error hint
 * when the request fails — never permanent dashes from static HTML.
 */

import { Briefcase, Building2, Coins, Scroll } from 'lucide-react';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import {
  useEstateEntities,
  useEstateAssets,
  useEstateCapitalMovements,
  useSuccessionPlans,
} from '@/lib/queries/estate';
import { formatLargeMoney, LAUNCH_CURRENCY } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

interface EstateMetricStripProps {
  readonly locale: Locale;
}

/**
 * Canonical succession-plan lifecycle statuses (mirrors
 * `SUCCESSION_PLAN_STATUSES` in
 * packages/database/src/schemas/succession-plans.schema.ts — the server
 * schema package is intentionally NOT pulled into this client bundle, so the
 * literals are pinned here as the single source of THIS render). Any drift
 * fails the typed `ATTENTION_STATUSES satisfies` check below.
 */
const SUCCESSION_PLAN_STATUSES = [
  'drafted',
  'witnessed',
  'registered',
  'contested',
  'executed',
] as const;
type SuccessionPlanStatus = (typeof SUCCESSION_PLAN_STATUSES)[number];

/**
 * The statuses that count toward the "needs attention" tile — sourced from
 * the CANONICAL enum literals (never a phantom value like `pending_review` /
 * `draft`, which never match and silently read 0 — a fabricated all-clear).
 * `drafted` = unfinished plan awaiting completion; `contested` = a plan under
 * dispute. `satisfies` proves both are real members of the enum at compile
 * time, so a renamed status breaks the build instead of dark-zeroing the tile.
 */
const ATTENTION_STATUSES = [
  'drafted',
  'contested',
] as const satisfies ReadonlyArray<SuccessionPlanStatus>;
const ATTENTION_STATUS_SET = new Set<string>(ATTENTION_STATUSES);

/** ISO date 30 days ago for the capital-movements since filter. */
function since30d(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function EstateMetricStrip({ locale }: EstateMetricStripProps) {
  const isSw = locale === 'sw';
  const labels = S.estate;

  // Fan-out queries — all independent
  const entitiesQuery = useEstateEntities({ tree: false });
  const assetsQuery = useEstateAssets({ limit: 500 });
  const movementsQuery = useEstateCapitalMovements({
    since: since30d(),
    limit: 200,
  });
  const successionQuery = useSuccessionPlans();

  // Entity count — useEstateEntities returns {success,data:{entities|tree,count}}
  const entityValue: string = (() => {
    if (entitiesQuery.isLoading) return '…';
    if (entitiesQuery.isError) return '—';
    const raw = entitiesQuery.data as
      | { success: boolean; data: { entities?: ReadonlyArray<unknown>; tree?: ReadonlyArray<unknown>; count: number } }
      | undefined;
    const d = raw?.data;
    if (!d) return '—';
    if ('entities' in d && Array.isArray(d.entities)) return String(d.entities.length);
    if ('tree' in d && Array.isArray(d.tree)) return String(d.tree.length);
    if (typeof d.count === 'number') return String(d.count);
    return '—';
  })();

  // Total asset value TZS — useEstateAssets returns {success,data:{assets,count}}
  const assetValue: string = (() => {
    if (assetsQuery.isLoading) return '…';
    if (assetsQuery.isError) return '—';
    const raw = assetsQuery.data as
      | { success: boolean; data: { assets: ReadonlyArray<{ currentValueTzs: string }>; count: number } }
      | undefined;
    const rows = raw?.data?.assets;
    if (!rows || rows.length === 0) return '—';
    const total = rows.reduce(
      (sum, a) => sum + (parseFloat(String(a.currentValueTzs)) || 0),
      0,
    );
    return total > 0 ? formatLargeMoney(total, LAUNCH_CURRENCY, locale) : '—';
  })();

  // 30-day capital flows — useEstateCapitalMovements returns {success,data:{movements,count}}
  // Movements may span multiple ISO currencies; summing across distinct
  // codes into one figure (and labelling it TZS) is invalid. Group the net
  // per currency code and render each separately; collapse to a single
  // figure only when every row shares one code.
  const capitalFlowValue: string = (() => {
    if (movementsQuery.isLoading) return '…';
    if (movementsQuery.isError) return '—';
    const raw = movementsQuery.data as
      | { success: boolean; data: { movements: ReadonlyArray<{ amount: string; currency: string }>; count: number } }
      | undefined;
    const rows = raw?.data?.movements;
    if (!rows || rows.length === 0) return '—';
    const netByCurrency = rows.reduce<Record<string, number>>((acc, m) => {
      const code = (m.currency || LAUNCH_CURRENCY).trim().toUpperCase();
      const amount = parseFloat(String(m.amount)) || 0;
      return { ...acc, [code]: (acc[code] ?? 0) + amount };
    }, {});
    const parts = Object.entries(netByCurrency)
      .filter(([, net]) => net !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, net]) => formatLargeMoney(Math.abs(net), code, locale));
    return parts.length > 0 ? parts.join(' · ') : '—';
  })();

  // Succession plan status — useSuccessionPlans returns {success,data:{plans,count}}
  const successionValue: string = (() => {
    if (successionQuery.isLoading) return '…';
    if (successionQuery.isError) return '—';
    const raw = successionQuery.data as
      | { success: boolean; data: { plans: ReadonlyArray<{ status: string }>; count: number } }
      | undefined;
    const plans = raw?.data?.plans;
    if (!plans) return '—';
    // Count plans whose status is a CANONICAL attention status (drafted /
    // contested) — sourced from the enum literals, never the phantom
    // `pending_review` / `draft` tokens that never match and read a false 0.
    const attention = plans.filter((p) =>
      ATTENTION_STATUS_SET.has(p.status),
    ).length;
    return String(attention);
  })();

  const tiles: readonly MetricTile[] = [
    {
      label: isSw ? labels.entitiesLabel.sw : labels.entitiesLabel.en,
      value: entityValue,
      icon: Building2,
      sub: isSw ? labels.entitiesSub.sw : labels.entitiesSub.en,
    },
    {
      label: isSw ? labels.assetValueLabel.sw : labels.assetValueLabel.en,
      value: assetValue,
      icon: Briefcase,
      sub: isSw ? labels.assetValueSub.sw : labels.assetValueSub.en,
    },
    {
      label: isSw ? labels.capitalFlowsLabel.sw : labels.capitalFlowsLabel.en,
      value: capitalFlowValue,
      icon: Coins,
      sub: isSw ? labels.capitalFlowsSub.sw : labels.capitalFlowsSub.en,
    },
    {
      label: isSw ? labels.successionLabel.sw : labels.successionLabel.en,
      value: successionValue,
      icon: Scroll,
      sub: isSw ? labels.successionSub.sw : labels.successionSub.en,
      tone: successionValue !== '0' && successionValue !== '—' ? 'warning' : 'default',
    },
  ];

  return <MetricStrip tiles={tiles} cols={4} />;
}
