/**
 * Control Tower client API + presentation metadata.
 *
 * Talks to the admin-web BFF (`/api/platform/control-tower`) which proxies to
 * the api-gateway. The gateway is the source of truth for each toggle's live
 * state and the four-eye / SOC2 enforcement; this module only shapes requests
 * + responses and carries the static UI copy per control id.
 */

import { getCsrfHeaders } from '@/lib/csrf';

export type ControlState = 'on' | 'off' | 'unknown';
export type ControlCategory = 'kill' | 'autonomy' | 'rate';

/** Live row returned by the gateway (`GET /controls`). */
export interface ControlRow {
  readonly id: string;
  readonly state: ControlState;
  readonly intValue?: number | null;
}

/** Static presentation metadata keyed by control id. */
export interface ControlMeta {
  readonly title: string;
  readonly description: string;
  readonly category: ControlCategory;
  readonly riskLabel: string;
}

export const CONTROL_META: Readonly<Record<string, ControlMeta>> = {
  'global-kill': {
    title: 'Global platform kill-switch',
    description:
      'Halts every brain inference, agent action, and outbound webhook across all tenants. Use only for active incident response.',
    category: 'kill',
    riskLabel: 'Catastrophic - 4 eyes',
  },
  'jr-autonomy': {
    title: 'Junior agent autonomy',
    description:
      'When on, junior agents may execute toolbox tasks without operator confirmation. Defaults off in production.',
    category: 'autonomy',
    riskLabel: 'High - 4 eyes',
  },
  'predictions-mode': {
    title: 'Predictions append mode',
    description:
      'Predictions append to rule-based decisions. Disabling forces all output through the deterministic policy gate.',
    category: 'autonomy',
    riskLabel: 'High - 4 eyes',
  },
  'webhook-rate-cap': {
    title: 'Outbound webhook rate cap',
    description:
      'Hard ceiling on per-tenant outbound webhook throughput. Default 600 req/min/tenant.',
    category: 'rate',
    riskLabel: 'Low - 2 eyes',
  },
  'embed-throttle': {
    title: 'Embeddings token throttle',
    description:
      'Throttles tenant embedding spend per minute. Off during corpus-bootstrap windows; otherwise on.',
    category: 'rate',
    riskLabel: 'Low - 2 eyes',
  },
};

interface ControlsEnvelope {
  readonly success: boolean;
  readonly data?: { readonly controls?: ReadonlyArray<Record<string, unknown>> };
  readonly error?: { readonly message?: string };
}

interface ToggleEnvelope {
  readonly success: boolean;
  readonly data?: {
    readonly status?: string;
    readonly requiresFourEye?: boolean;
    readonly journalId?: string;
  };
  readonly error?: { readonly message?: string; readonly code?: string };
}

export interface ToggleRequest {
  readonly controlId: string;
  readonly desiredState: 'on' | 'off';
  readonly reason: string;
}

export interface ToggleResult {
  readonly status: 'applied' | 'pending_approval';
  readonly requiresFourEye: boolean;
  readonly journalId?: string;
}

function authHeaders(): HeadersInit {
  const token =
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('platform_token')
      : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normaliseState(raw: unknown): ControlState {
  return raw === 'on' ? 'on' : raw === 'off' ? 'off' : 'unknown';
}

/** GET the live state of every control. */
export async function fetchControls(): Promise<ReadonlyArray<ControlRow>> {
  const res = await fetch('/api/platform/control-tower', {
    headers: authHeaders(),
    credentials: 'include',
    cache: 'no-store',
  });
  const body = (await res.json()) as ControlsEnvelope;
  if (!res.ok || !body.success) {
    throw new Error(body.error?.message ?? `controls returned ${res.status}`);
  }
  const rows = body.data?.controls ?? [];
  return rows
    .map((r) => ({
      id: String(r.id ?? ''),
      state: normaliseState(r.state),
      intValue: typeof r.intValue === 'number' ? r.intValue : null,
    }))
    .filter((r) => r.id.length > 0);
}

/** POST a toggle change; returns whether it applied or needs a second eye. */
export async function postToggle(req: ToggleRequest): Promise<ToggleResult> {
  const res = await fetch('/api/platform/control-tower', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...getCsrfHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify(req),
  });
  const body = (await res.json()) as ToggleEnvelope;
  if (!res.ok || !body.success) {
    throw new Error(
      body.error?.message ?? `toggle failed (${body.error?.code ?? res.status})`,
    );
  }
  const status = body.data?.status === 'applied' ? 'applied' : 'pending_approval';
  return {
    status,
    requiresFourEye: Boolean(body.data?.requiresFourEye),
    ...(body.data?.journalId ? { journalId: body.data.journalId } : {}),
  };
}
