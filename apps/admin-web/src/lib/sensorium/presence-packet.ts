/**
 * Presence packet — Central Command Phase A (C4 Brain Skin).
 *
 * Assembles the "where is the user right now?" payload the AG-UI
 * client (C1) attaches to every chat turn. The brain sees this
 * BEFORE every reasoning step and uses it for:
 *
 *   - Disambiguating "show me" / "what about this" referents.
 *   - Reading the a11y-tree digest as a perception cache key.
 *   - Detecting "user is on the warehouse page" → biasing tool
 *     selection.
 *
 * The packet is small (typically <2KB) so it can ride the chat
 * request body without bloating prompt-token budgets.
 */

import type { A11ySnapshot } from './a11y-tree-snapshot.js';
import { snapshotA11yTree } from './a11y-tree-snapshot.js';
import { truncate } from './pii-redactor.js';

export interface PresencePacket {
  readonly route: string;
  readonly surface: string;
  readonly selection?: { readonly text: string; readonly nodeId?: string };
  readonly focusedElement?: {
    readonly role: string;
    readonly name?: string;
    readonly ariaLabel?: string;
  };
  readonly lastQueryAt?: number;
  readonly a11yTreeDigest: string;
  readonly visibleRoles: ReadonlyArray<string>;
  readonly viewportSize: { readonly w: number; readonly h: number };
}

export interface AssemblePresenceArgs {
  readonly surface: string;
  readonly lastQueryAt?: number;
  /** Override the snapshot — test seam. */
  readonly snapshot?: A11ySnapshot;
}

export function assemblePresence(
  args: AssemblePresenceArgs,
): PresencePacket {
  const snapshot = args.snapshot ?? snapshotA11yTree();
  const route = readRoute();
  const viewportSize = readViewportSize();
  const selection = readSelection();
  const focusedElement = readFocusedElement();

  return {
    route,
    surface: args.surface,
    ...(selection ? { selection } : {}),
    ...(focusedElement ? { focusedElement } : {}),
    ...(args.lastQueryAt ? { lastQueryAt: args.lastQueryAt } : {}),
    a11yTreeDigest: snapshot.digest,
    visibleRoles: snapshot.visibleRoles,
    viewportSize,
  };
}

function readRoute(): string {
  if (typeof window === 'undefined') return '/';
  try {
    return `${window.location.pathname}${window.location.search}`;
  } catch {
    return '/';
  }
}

function readViewportSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return {
    w: window.innerWidth || 0,
    h: window.innerHeight || 0,
  };
}

function readSelection(): { text: string; nodeId?: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return undefined;
    const text = sel.toString().trim();
    if (!text) return undefined;
    const truncated = truncate(text, 200);
    const anchorNode = sel.anchorNode as (Node & { parentElement?: Element }) | null;
    const nodeId =
      anchorNode?.parentElement?.id ||
      (anchorNode as Element | null)?.id ||
      undefined;
    return {
      text: truncated,
      ...(nodeId ? { nodeId } : {}),
    };
  } catch {
    return undefined;
  }
}

function readFocusedElement():
  | { role: string; name?: string; ariaLabel?: string }
  | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return undefined;
  const role =
    el.getAttribute('role') ?? el.tagName.toLowerCase();
  const ariaLabel = el.getAttribute('aria-label') ?? undefined;
  const name =
    el.getAttribute('title') ??
    el.getAttribute('placeholder') ??
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      ? undefined
      : (el.textContent ?? '').trim().slice(0, 80) || undefined);
  return {
    role,
    ...(name ? { name } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
  };
}
