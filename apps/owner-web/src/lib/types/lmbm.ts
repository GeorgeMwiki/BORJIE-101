/**
 * LMBM (Living Mining Business Map) graph type shapes.
 */

export type LmbmNodeKind =
  | 'company'
  | 'licence'
  | 'site'
  | 'document'
  | 'person'
  | 'event';

export interface LmbmNode {
  readonly id: string;
  readonly kind: LmbmNodeKind;
  readonly label: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly attributes: Record<string, string | number>;
  readonly evidence: ReadonlyArray<{
    readonly source: string;
    readonly excerpt: string;
    readonly confidence: number;
  }>;
}

export interface LmbmEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
}

export interface LmbmGraph {
  readonly nodes: ReadonlyArray<LmbmNode>;
  readonly edges: ReadonlyArray<LmbmEdge>;
  readonly asOf: string;
}
