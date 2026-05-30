"use client";

/**
 * 17. tree — hierarchical navigation (no-dep recursive expand/collapse).
 *
 * Used for owner → portfolio → property → block → unit drill-downs.
 * Click actions dispatch a DOM CustomEvent `genui:tree-action` with
 * the TreeAction payload so the host app can route to a tool/message/
 * navigate.
 */

import { useState } from "react";

import type { TreeAction, TreeNode } from "../types";
import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { TreePartSchema } from "../schemas";

export type TreeProps = AgUiUiPartByKind<"tree">;

function dispatchAction(action: TreeAction, nodeId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("genui:tree-action", {
        detail: { nodeId, ...action },
      }),
    );
  } catch {
    // ignore
  }
}

interface TreeRowProps {
  readonly node: TreeNode;
  readonly depth: number;
}

function TreeRow({ node, depth }: TreeRowProps): JSX.Element {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <li className="text-sm">
      <div
        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-sunken"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-4 text-xs text-muted-foreground"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => {
            if (node.onClickAction) dispatchAction(node.onClickAction, node.id);
          }}
          className="flex-1 text-left text-foreground"
        >
          {node.label}
        </button>
        {node.badge ? (
          <span className="rounded bg-surface-sunken px-1 py-0.5 text-[10px] text-muted-foreground">
            {node.badge}
          </span>
        ) : null}
      </div>
      {hasChildren && open ? (
        <ul className="m-0 list-none p-0">
          {node.children!.map((c) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Tree(props: TreeProps): JSX.Element {
  const parsed = TreePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="tree"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="tree" {...(props.title ? { title: props.title } : {})}>
      <ul className="m-0 list-none p-0">
        <TreeRow node={props.root} depth={0} />
      </ul>
    </Frame>
  );
}
