'use client';

/**
 * SelfModelPanel — the compact honest-epistemic surface (Win #2 / INV-H).
 *
 * The Borjie brain emits an ADDITIVE `self_model` SSE frame after each
 * non-refusal answer. It carries the MD's POSTURE toward the answer plus three
 * plain-language axes:
 *   - SURE ABOUT   — what the answer is well-grounded on
 *   - UNSURE ABOUT — the axes it is least certain along
 *   - WOULD NEED   — what the owner could provide to firm it up
 *
 * INV-H (honest-confidence): this surfaces POSTURE + AXES only — a fixed
 * posture enum + constant axis labels — NEVER the raw audit math (the
 * four-axis numbers stay server-side). The gateway egress membrane already
 * shape-clamps the payload; this renderer is purely presentational.
 *
 * Locale-pure: every label resolves through the i18n dictionary (`t`); no
 * EN/SW mixing. Small + unobtrusive — a posture badge + three short lists,
 * rendered under the assistant answer only when at least one axis is present.
 */

import type { ReactElement } from 'react';
import { ShieldCheck, HelpCircle, Sparkles } from 'lucide-react';
import type { TFn } from '@/i18n/resolve';

/** The fixed posture vocabulary the kernel may surface (INV-H). */
export type SelfModelPosture =
  | 'answering'
  | 'reasoning'
  | 'clarifying'
  | 'softening'
  | 'refusing'
  | 'deferring';

/**
 * Parsed honest-epistemic self-model for one assistant turn. Every field is
 * already egress-safe (the gateway membrane clamps shape + posture); this is
 * the client-side mirror.
 */
export interface SelfModelView {
  readonly posture: SelfModelPosture;
  readonly sureAbout: ReadonlyArray<string>;
  readonly unsureAbout: ReadonlyArray<string>;
  readonly wouldNeed: ReadonlyArray<string>;
}

const POSTURES: ReadonlyArray<SelfModelPosture> = [
  'answering',
  'reasoning',
  'clarifying',
  'softening',
  'refusing',
  'deferring',
];

const AXIS_CAP = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPosture(value: unknown): value is SelfModelPosture {
  return (
    typeof value === 'string' &&
    (POSTURES as ReadonlyArray<string>).includes(value)
  );
}

function axisList(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, AXIS_CAP);
}

/**
 * Normalise a raw `self_model` SSE payload into a SelfModelView. Returns null
 * when the payload is not a record, the posture is unknown, OR all three axes
 * are empty (nothing worth surfacing) — a malformed / empty frame must never
 * render a half-formed panel.
 */
export function normaliseSelfModel(value: unknown): SelfModelView | null {
  if (!isRecord(value)) return null;
  const posture: SelfModelPosture = isPosture(value.posture)
    ? value.posture
    : 'answering';
  const sureAbout = axisList(value.sureAbout);
  const unsureAbout = axisList(value.unsureAbout);
  const wouldNeed = axisList(value.wouldNeed);
  if (
    sureAbout.length === 0 &&
    unsureAbout.length === 0 &&
    wouldNeed.length === 0
  ) {
    return null;
  }
  return { posture, sureAbout, unsureAbout, wouldNeed };
}

/**
 * Map a posture to its badge tone. Confident postures (answering / reasoning)
 * read as "confident"; clarifying / deferring read as "needs-data"; softening /
 * refusing read as "unsure".
 */
type BadgeTone = 'confident' | 'unsure' | 'needs-data';

function postureTone(posture: SelfModelPosture): BadgeTone {
  switch (posture) {
    case 'answering':
    case 'reasoning':
      return 'confident';
    case 'clarifying':
    case 'deferring':
      return 'needs-data';
    case 'softening':
    case 'refusing':
      return 'unsure';
  }
}

const TONE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  confident: 'border-success/40 bg-success/10 text-success',
  unsure: 'border-warning/40 bg-warning/10 text-warning',
  'needs-data': 'border-info/40 bg-info/10 text-info',
};

export interface SelfModelPanelProps {
  readonly selfModel: SelfModelView;
  readonly t: TFn;
}

/**
 * Render the compact epistemic panel: a posture badge plus up to three short
 * labelled lists. Rendered under the assistant bubble. Each list is omitted
 * when empty so the panel stays minimal.
 */
export function SelfModelPanel({
  selfModel,
  t,
}: SelfModelPanelProps): ReactElement {
  const tone = postureTone(selfModel.posture);
  const badgeLabel = t(`teach.selfModel.posture.${selfModel.posture}`);

  return (
    <div
      data-testid="teach-self-model"
      className="ml-10 flex max-w-2xl flex-col gap-2 rounded-xl border border-border bg-surface/40 px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <span
          data-testid="teach-self-model-posture"
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-tiny font-medium ${TONE_CLASSES[tone]}`}
        >
          <ShieldCheck aria-hidden="true" className="h-3 w-3" />
          {badgeLabel}
        </span>
        <span className="text-tiny uppercase tracking-wide text-neutral-500">
          {t('teach.selfModel.title')}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {selfModel.sureAbout.length > 0 ? (
          <AxisRow
            testId="teach-self-model-sure"
            icon={
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 shrink-0 text-success"
              />
            }
            label={t('teach.selfModel.sureAbout')}
            items={selfModel.sureAbout}
          />
        ) : null}
        {selfModel.unsureAbout.length > 0 ? (
          <AxisRow
            testId="teach-self-model-unsure"
            icon={
              <HelpCircle
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 shrink-0 text-warning"
              />
            }
            label={t('teach.selfModel.unsureAbout')}
            items={selfModel.unsureAbout}
          />
        ) : null}
        {selfModel.wouldNeed.length > 0 ? (
          <AxisRow
            testId="teach-self-model-would-need"
            icon={
              <Sparkles
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 shrink-0 text-info"
              />
            }
            label={t('teach.selfModel.wouldNeed')}
            items={selfModel.wouldNeed}
          />
        ) : null}
      </div>
    </div>
  );
}

interface AxisRowProps {
  readonly testId: string;
  readonly icon: ReactElement;
  readonly label: string;
  readonly items: ReadonlyArray<string>;
}

function AxisRow({ testId, icon, label, items }: AxisRowProps): ReactElement {
  return (
    <div data-testid={testId} className="flex items-start gap-1.5">
      {icon}
      <div className="flex flex-col gap-0.5">
        <p className="text-tiny font-semibold uppercase tracking-wide text-neutral-400">
          {label}
        </p>
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {items.map((item, i) => (
            <li key={`${item}_${i}`} className="text-tiny text-neutral-300">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
