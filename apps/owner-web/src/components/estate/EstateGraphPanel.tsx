'use client';

import { useMemo, type ReactElement } from 'react';
import { Network, AlertTriangle } from 'lucide-react';
import {
  GraphVizBlock,
  RoyaltyFlowSankey,
  type GraphVizBlockPayload,
} from '@borjie/graph-viz';
import {
  useEstateEntities,
  useEstateCapitalMovements,
  type EstateEntityTreeNode,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import {
  entityTreeToGraph,
  capitalMovementsToRoyaltyFlows,
  nameLookupFromGraph,
} from '@/lib/estate-graph';
import { estateGraphPanelStrings as COPY } from '@/i18n/strings/estate-graph-panel';

/**
 * Estate graph panel — renders the holding/subsidiary structure as an
 * interactive org graph and the inter-entity capital movements as a
 * royalty-flow Sankey, both via `@borjie/graph-viz` fed by the REAL
 * estate API (`/api/v1/estate/entities?tree=1` +
 * `/api/v1/estate/capital-movements`).
 *
 * graph-viz's engine wrappers lazy-load their canvas libs in the
 * browser and degrade to an accessible SVG fallback when a lib is
 * absent, so this panel is safe to mount without bundling the heavy
 * graph engines. Mounted alongside `EstateOverview` — it does not touch
 * the page nav. All states render real copy; nothing is fabricated.
 */

interface EstateGraphPanelProps {
  readonly locale: 'sw' | 'en';
}

function flattenTree(
  nodes: ReadonlyArray<EstateEntityTreeNode>,
): ReadonlyArray<EstateEntityTreeNode> {
  // Used only to gate the empty-state; the projection walks the tree
  // itself. Iterative to avoid recursion-depth surprises.
  const out: EstateEntityTreeNode[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

export function EstateGraphPanel({ locale }: EstateGraphPanelProps): ReactElement {
  const isSw = locale === 'sw';
  const entitiesQ = useEstateEntities({ tree: true });
  const movementsQ = useEstateCapitalMovements({ limit: 200 });

  const tree = useMemo(() => {
    const data = entitiesQ.data?.data as
      | { tree: ReadonlyArray<EstateEntityTreeNode>; count: number }
      | undefined;
    return data?.tree ?? [];
  }, [entitiesQ.data]);

  const orgGraph = useMemo(() => entityTreeToGraph(tree), [tree]);

  const royaltyFlows = useMemo(() => {
    const movements = movementsQ.data?.data?.movements ?? [];
    const nameById = nameLookupFromGraph(orgGraph);
    return capitalMovementsToRoyaltyFlows(movements, nameById);
  }, [movementsQ.data, orgGraph]);

  const graphPayload: GraphVizBlockPayload = useMemo(
    () => ({
      kind: 'graph-viz',
      shape: 'graph',
      nodes: orgGraph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        ...(n.data ? { data: n.data } : {}),
      })),
      edges: orgGraph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        directed: e.directed,
      })),
      ariaLabel: isSw
        ? `${COPY.orgGraphAria.prefix.sw}${orgGraph.nodes.length}${COPY.orgGraphAria.suffix.sw}`
        : `${COPY.orgGraphAria.prefix.en}${orgGraph.nodes.length}${COPY.orgGraphAria.suffix.en}`,
    }),
    [orgGraph, isSw],
  );

  const isLoading = entitiesQ.isLoading || movementsQ.isLoading;
  const isError = entitiesQ.isError;

  if (isLoading) {
    return (
      <SectionCard title={isSw ? COPY.orgTitle.sw : COPY.orgTitle.en}>
        <div className="px-5 py-8 text-sm text-neutral-400">
          {isSw ? COPY.loading.sw : COPY.loading.en}
        </div>
      </SectionCard>
    );
  }

  if (isError) {
    return (
      <SectionCard title={isSw ? COPY.orgTitle.sw : COPY.orgTitle.en}>
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {isSw ? COPY.loadError.sw : COPY.loadError.en}
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title={isSw ? COPY.orgTitle.sw : COPY.orgTitle.en}
        subtitle={isSw ? COPY.orgSubtitle.sw : COPY.orgSubtitle.en}
        actions={<Network className="h-4 w-4 text-neutral-400" />}
      >
        <div className="px-5 py-4">
          {orgGraph.nodes.length === 0 ? (
            <p className="text-sm text-neutral-400">
              {isSw ? COPY.noEntities.sw : COPY.noEntities.en}
            </p>
          ) : (
            <GraphVizBlock payload={graphPayload} testId="estate-org-graph" />
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={isSw ? COPY.flowTitle.sw : COPY.flowTitle.en}
        subtitle={isSw ? COPY.flowSubtitle.sw : COPY.flowSubtitle.en}
      >
        <div className="px-5 py-4">
          {royaltyFlows.length === 0 ? (
            <p className="text-sm text-neutral-400">
              {isSw ? COPY.noFlows.sw : COPY.noFlows.en}
            </p>
          ) : (
            <RoyaltyFlowSankey
              flows={royaltyFlows}
              themeName="brand-dark"
              ariaLabel={
                isSw
                  ? `${COPY.flowSankeyAria.prefix.sw}${royaltyFlows.length}${COPY.flowSankeyAria.suffix.sw}`
                  : `${COPY.flowSankeyAria.prefix.en}${royaltyFlows.length}${COPY.flowSankeyAria.suffix.en}`
              }
              testId="estate-capital-flow-sankey"
            />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
