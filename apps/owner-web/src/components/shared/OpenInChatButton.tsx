'use client';

import Link from 'next/link';

/**
 * "Talk to Mr. Mwikila about this" affordance.
 *
 * Implements the bidirectional principle: every explicit form / detail
 * view in the owner-web app gains a small icon button in its
 * top-right corner. Click → opens the home chat scoped to the current
 * entity ("@-referenced"). Pre-fills the chat input so the owner can
 * just start typing the question instead of repeating context.
 *
 * The corresponding chat-side affordance ("Open in tab" chip) lives
 * inside the chat reply renderer; that chip jumps from a chat-mentioned
 * entity to the entity's explicit detail view.
 */

interface OpenInChatButtonProps {
  /**
   * Stable entity reference used as the `@-mention` in the pre-filled
   * chat input (e.g. `parcel-GLD-2026-04-12`, `draft-MSA-Mahenge`,
   * `reminder-5`). The entity prefix is recognised by the home chat
   * renderer to render a chip linking back to the explicit view.
   */
  readonly entityRef: string;
  /** Human label rendered to the right of the icon. Default 'Ask'. */
  readonly label?: string;
  /** Compact mode — render only the icon. */
  readonly compact?: boolean;
}

export function OpenInChatButton({
  entityRef,
  label = 'Ask',
  compact = false,
}: OpenInChatButtonProps) {
  const prefill = encodeURIComponent(`@${entityRef} `);
  const href = `/dashboard/chat?prefill=${prefill}&context=${encodeURIComponent(entityRef)}`;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 px-2 py-1 text-xs text-warning hover:bg-warning-subtle/10"
      title={`Talk to Mr. Mwikila about ${entityRef}`}
    >
      <span aria-hidden>M</span>
      {!compact && <span>{label}</span>}
    </Link>
  );
}
