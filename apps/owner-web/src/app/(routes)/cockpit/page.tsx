import { redirect } from 'next/navigation';

/**
 * O-W-01 — Cockpit dashboard.
 *
 * The cockpit lives at `/` (the owner's home). This sibling route
 * exists so the sidebar can link to a stable `/cockpit` URL without
 * duplicating the dashboard; it forwards to `/`.
 */
export default function CockpitRedirect(): never {
  redirect('/');
}
