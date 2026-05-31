/**
 * Wave SUPERPOWERS (admin-web) — cross-component event bus.
 *
 * Mirrors the owner-web bus in
 * `apps/owner-web/src/components/home-chat/SuperpowerChips.tsx`. Two
 * synthetic CustomEvents fly across the window so any admin form can
 * listen for prefill-from-chat, and any admin surface can listen for a
 * highlight pulse.
 *
 * Why a window event bus: forms and the chat surface live in different
 * route subtrees and don't share a React context. CustomEvents keep
 * the wiring minimal and SSR-safe (the publish helpers are no-ops when
 * `window` is undefined).
 */

export type FormPrefillEvent = {
  readonly formId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly submitOnAccept: boolean;
};

export type HighlightEvent = {
  readonly selector: string;
  readonly message: { readonly en: string; readonly sw: string };
  readonly ttl: number;
  readonly tone: 'info' | 'success' | 'warning' | 'critical';
};

export const ADMIN_FORM_PREFILL_EVENT_NAME = 'borjie:admin:form-prefill';
export const ADMIN_HIGHLIGHT_EVENT_NAME = 'borjie:admin:highlight';
export const ADMIN_BULK_DRAWER_EVENT_NAME = 'borjie:admin:bulk-drawer-open';

export function publishAdminFormPrefill(payload: FormPrefillEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_FORM_PREFILL_EVENT_NAME, { detail: payload }),
  );
}

export function publishAdminHighlight(payload: HighlightEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(ADMIN_HIGHLIGHT_EVENT_NAME, { detail: payload }),
  );
}

export function openAdminBulkDrawer(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ADMIN_BULK_DRAWER_EVENT_NAME));
}
