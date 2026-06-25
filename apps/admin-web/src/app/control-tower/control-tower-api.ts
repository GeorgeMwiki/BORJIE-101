/**
 * Control Tower client API + presentation metadata.
 *
 * Talks to the admin-web BFF (`/api/platform/control-tower`) which proxies to
 * the api-gateway. The gateway is the source of truth for each toggle's live
 * state and the four-eye / SOC2 enforcement; this module only shapes requests
 * + responses and carries the static UI copy per control id.
 */

import { getCsrfHeaders } from '@/lib/csrf';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

export type ControlState = 'on' | 'off' | 'unknown';
export type ControlCategory = 'kill' | 'autonomy' | 'rate';

/** Live row returned by the gateway (`GET /controls`). */
export interface ControlRow {
  readonly id: string;
  readonly state: ControlState;
  readonly intValue?: number | null;
}

/** A single localized variant of a control's presentation copy. */
type LocaleVariant = { readonly en: string; readonly sw: string };

/**
 * Bilingual presentation metadata keyed by control id. `category` is a
 * non-user-facing tone selector (icon/colour) so it stays a flat string;
 * every user-VISIBLE field carries full en/sw parity. Resolve to a single
 * active locale at render via `localizeControlMeta` — never render both.
 */
export interface ControlMetaSource {
  readonly title: LocaleVariant;
  readonly description: LocaleVariant;
  readonly category: ControlCategory;
  readonly riskLabel: LocaleVariant;
}

/** Single-language presentation metadata, resolved for the active locale. */
export interface ControlMeta {
  readonly title: string;
  readonly description: string;
  readonly category: ControlCategory;
  readonly riskLabel: string;
}

export const CONTROL_META_SOURCE: Readonly<Record<string, ControlMetaSource>> = {
  'global-kill': {
    title: {
      en: 'Global platform kill-switch',
      sw: 'Kizima-dharura cha jukwaa zima',
    },
    description: {
      en: 'Halts every brain inference, agent action, and outbound webhook across all tenants. Use only for active incident response.',
      sw: 'Husimamisha kila utabiri wa ubongo, kitendo cha wakala, na webhook ya kutoka kwa wateja wote. Tumia tu wakati wa kukabiliana na tukio linaloendelea.',
    },
    category: 'kill',
    riskLabel: { en: 'Catastrophic - 4 eyes', sw: 'Janga - macho 4' },
  },
  'jr-autonomy': {
    title: { en: 'Junior agent autonomy', sw: 'Uhuru wa wakala msaidizi' },
    description: {
      en: 'When on, junior agents may execute toolbox tasks without operator confirmation. Defaults off in production.',
      sw: 'Ikiwashwa, wakala wasaidizi wanaweza kutekeleza kazi za zana bila uthibitisho wa mendeshaji. Hubaki imezimwa katika uzalishaji.',
    },
    category: 'autonomy',
    riskLabel: { en: 'High - 4 eyes', sw: 'Juu - macho 4' },
  },
  'predictions-mode': {
    title: { en: 'Predictions append mode', sw: 'Hali ya kuongeza utabiri' },
    description: {
      en: 'Predictions append to rule-based decisions. Disabling forces all output through the deterministic policy gate.',
      sw: 'Utabiri huongezwa kwenye maamuzi yanayotegemea kanuni. Kuzima hulazimisha matokeo yote kupita lango la sera lenye uhakika.',
    },
    category: 'autonomy',
    riskLabel: { en: 'High - 4 eyes', sw: 'Juu - macho 4' },
  },
  'webhook-rate-cap': {
    title: { en: 'Outbound webhook rate cap', sw: 'Kikomo cha kasi ya webhook ya kutoka' },
    description: {
      en: 'Hard ceiling on per-tenant outbound webhook throughput. Default 600 req/min/tenant.',
      sw: 'Kikomo kigumu cha kasi ya webhook ya kutoka kwa kila mteja. Chaguomsingi ni maombi 600 kwa dakika kwa kila mteja.',
    },
    category: 'rate',
    riskLabel: { en: 'Low - 2 eyes', sw: 'Chini - macho 2' },
  },
  'embed-throttle': {
    title: { en: 'Embeddings token throttle', sw: 'Kidhibiti cha tokeni za uingizaji' },
    description: {
      en: 'Throttles tenant embedding spend per minute. Off during corpus-bootstrap windows; otherwise on.',
      sw: 'Hudhibiti matumizi ya uingizaji ya mteja kwa dakika. Imezimwa wakati wa madirisha ya kuanzisha kanzidata; vinginevyo imewashwa.',
    },
    category: 'rate',
    riskLabel: { en: 'Low - 2 eyes', sw: 'Chini - macho 2' },
  },
};

/** Resolve one control's metadata to the active locale (zero EN/SW mixing). */
export function localizeControlMeta(
  source: ControlMetaSource,
  locale: Locale,
): ControlMeta {
  return {
    title: pickByLocale(locale, source.title),
    description: pickByLocale(locale, source.description),
    category: source.category,
    riskLabel: pickByLocale(locale, source.riskLabel),
  };
}

/** Look up + localize a control's metadata by id; `undefined` if unknown. */
export function controlMetaFor(
  id: string,
  locale: Locale,
): ControlMeta | undefined {
  const source = CONTROL_META_SOURCE[id];
  return source ? localizeControlMeta(source, locale) : undefined;
}

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

interface ApproveEnvelope {
  readonly success: boolean;
  readonly data?: { readonly applied?: boolean; readonly journalId?: string };
  readonly error?: { readonly message?: string; readonly code?: string };
}

export interface ApproveResult {
  readonly applied: boolean;
  readonly journalId?: string;
}

/** A toggle that has been proposed and is awaiting a second operator. */
export interface PendingApproval {
  readonly journalId: string;
  readonly controlId: string;
  readonly desiredState: 'on' | 'off';
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

/**
 * POST the SECOND-operator approval for a pending HIGH-impact toggle. The
 * gateway runs the real mutation here and REJECTS same-actor approvals
 * (FOUR_EYE_SAME_ACTOR / 409) — so the proposing operator gets an honest
 * error and only a DIFFERENT operator can complete the four-eye loop.
 */
export async function approveToggle(
  journalId: string,
  decisionNote?: string,
): Promise<ApproveResult> {
  const res = await fetch(
    `/api/platform/control-tower/${encodeURIComponent(journalId)}/approve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...getCsrfHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(
        decisionNote && decisionNote.trim().length > 0
          ? { decisionNote: decisionNote.trim() }
          : {},
      ),
    },
  );
  const body = (await res.json()) as ApproveEnvelope;
  if (!res.ok || !body.success) {
    throw new Error(
      body.error?.message ??
        `approval failed (${body.error?.code ?? res.status})`,
    );
  }
  return {
    applied: Boolean(body.data?.applied),
    ...(body.data?.journalId ? { journalId: body.data.journalId } : {}),
  };
}
