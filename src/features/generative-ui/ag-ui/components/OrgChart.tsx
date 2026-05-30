"use client";

/**
 * 29. org-chart — hierarchical relationship graph
 * (tenant ↔ guarantor ↔ co-applicant, owner ↔ portfolios ↔ properties).
 *
 * Pure CSS + SVG connector lines. No heavy graph libs. Recursive
 * indentation for vertical layout; horizontal layout uses CSS grid.
 */

import type { AgUiUiPartByKind, OrgChartNode } from "../types";
import { Frame, GenUiError } from "./Frame";
import { OrgChartPartSchema } from "../schemas";

export type OrgChartProps = AgUiUiPartByKind<"org-chart">;

interface OrgChartRowProps {
  readonly node: OrgChartNode;
  readonly depth: number;
}

function OrgChartRow({ node, depth }: OrgChartRowProps): JSX.Element {
  return (
    <li className="list-none">
      <div
        className="my-1 flex items-center gap-2 rounded border border-border bg-surface px-2 py-1 text-xs"
        style={{ marginLeft: depth * 16 }}
      >
        <span aria-hidden className="text-muted-foreground">
          {depth === 0 ? "◆" : "└"}
        </span>
        <span className="font-medium text-foreground">{node.label}</span>
        {node.role ? (
          <span className="text-muted-foreground">— {node.role}</span>
        ) : null}
        {node.badge ? (
          <span className="ml-auto rounded bg-surface-sunken px-1.5 py-0.5 text-[10px]">
            {node.badge}
          </span>
        ) : null}
      </div>
      {node.children && node.children.length > 0 ? (
        <ul className="m-0 p-0">
          {node.children.map((c) => (
            <OrgChartRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function OrgChart(props: OrgChartProps): JSX.Element {
  const parsed = OrgChartPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="org-chart"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="org-chart" {...(props.title ? { title: props.title } : {})}>
      <ul className="m-0 p-0">
        <OrgChartRow node={props.root} depth={0} />
      </ul>
    </Frame>
  );
}
