import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-03 — Living Mining Business Map (LMBM) graph explorer.
 *
 * Read-only Cytoscape / Sigma graph over the LMBM (companies,
 * licences, sites, people, documents, events). Clicking any node
 * opens a provenance trace showing the evidence chain that put it
 * in the graph.
 */
export default function LmbmPage() {
  return (
    <>
      <ScreenHeader slug="lmbm" />
      <div className="space-y-4 px-8 py-6">
        <PlaceholderCard title="Graph canvas">
          Force-directed graph of the LMBM — Company, Licence, Site, Person,
          Document, Event nodes. Wired via @borjie/graph-privacy.
        </PlaceholderCard>
        <PlaceholderCard title="Provenance trace">
          Selected node detail: source document(s), confidence band, last
          updated, junior agent that wrote it.
        </PlaceholderCard>
        <PlaceholderCard title="Query bar">
          Cypher-like query input for advanced owners ("show every licence
          with a fee gate in the next 60 days").
        </PlaceholderCard>
      </div>
    </>
  );
}
