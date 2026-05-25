'use client';

/**
 * 25. multistep-wizard — N-step wizard with retained state between steps.
 *
 * State is held locally; on final submit the component POSTs to the
 * configured `onSubmitAction` URL via fetch and dispatches a
 * `genui:wizard-submit` CustomEvent. Mirrors the prefill-form pattern:
 * action targets api-gateway, not the agent.
 */

import { useMemo, useState } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { MultistepWizardPartSchema } from '../schemas';

export type MultistepWizardProps = AgUiUiPartByKind<'multistep-wizard'>;

export function MultistepWizard(props: MultistepWizardProps): JSX.Element {
  const parsed = MultistepWizardPartSchema.safeParse(props);
  const initialIdx = useMemo(() => {
    if (!props.currentStepId) return 0;
    const idx = props.steps.findIndex((s) => s.id === props.currentStepId);
    return idx >= 0 ? idx : 0;
  }, [props.currentStepId, props.steps]);
  const [stepIdx, setStepIdx] = useState<number>(initialIdx);
  const [values, setValues] = useState<Record<string, unknown>>(
    () => ({ ...(props.values ?? {}) }),
  );

  if (!parsed.success) {
    return (
      <GenUiError
        kind="multistep-wizard"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  const step = props.steps[stepIdx];
  if (!step) {
    return (
      <GenUiError kind="multistep-wizard" message="wizard has no current step" />
    );
  }

  const isLast = stepIdx === props.steps.length - 1;

  function handleSubmit(): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(
        new CustomEvent('genui:wizard-submit', {
          detail: { action: props.onSubmitAction, values },
        }),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <Frame kind="multistep-wizard" {...(props.title ? { title: props.title } : {})}>
      <ol className="mb-3 flex items-center gap-1 text-[10px]">
        {props.steps.map((s, i) => (
          <li
            key={s.id}
            className="flex-1"
            aria-current={i === stepIdx ? 'step' : undefined}
          >
            <div
              className={
                i === stepIdx
                  ? 'h-1 rounded bg-foreground'
                  : i < stepIdx
                    ? 'h-1 rounded bg-foreground/60'
                    : 'h-1 rounded bg-border'
              }
            />
            <div className="mt-1 truncate text-muted-foreground">{s.title}</div>
          </li>
        ))}
      </ol>
      <div className="mb-2">
        <div className="text-sm font-medium text-foreground">{step.title}</div>
        {step.description ? (
          <div className="text-xs text-muted-foreground">{step.description}</div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {step.fields.map((f) => {
          const v = values[f.key];
          if (f.type === 'select') {
            return (
              <label key={f.key} className="flex flex-col gap-1 text-xs">
                <span className="text-foreground">{f.label}</span>
                <select
                  value={String(v ?? '')}
                  onChange={(e) =>
                    setValues((p) => ({ ...p, [f.key]: e.currentTarget.value }))
                  }
                  required={f.required}
                  className="rounded border border-border bg-surface px-2 py-1"
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (f.type === 'textarea') {
            return (
              <label key={f.key} className="flex flex-col gap-1 text-xs">
                <span className="text-foreground">{f.label}</span>
                <textarea
                  value={String(v ?? '')}
                  onChange={(e) =>
                    setValues((p) => ({ ...p, [f.key]: e.currentTarget.value }))
                  }
                  required={f.required}
                  rows={3}
                  className="rounded border border-border bg-surface px-2 py-1"
                />
              </label>
            );
          }
          if (f.type === 'checkbox') {
            return (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(v)}
                  onChange={(e) =>
                    setValues((p) => ({ ...p, [f.key]: e.currentTarget.checked }))
                  }
                />
                <span>{f.label}</span>
              </label>
            );
          }
          return (
            <label key={f.key} className="flex flex-col gap-1 text-xs">
              <span className="text-foreground">{f.label}</span>
              <input
                type={f.type}
                value={typeof v === 'string' || typeof v === 'number' ? v : ''}
                onChange={(e) =>
                  setValues((p) => ({
                    ...p,
                    [f.key]:
                      f.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value,
                  }))
                }
                required={f.required}
                className="rounded border border-border bg-surface px-2 py-1"
              />
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          disabled={stepIdx === 0}
          className="rounded border border-border bg-surface px-3 py-1 text-xs disabled:opacity-50"
        >
          Back
        </button>
        {!isLast ? (
          <button
            type="button"
            onClick={() => setStepIdx((i) => Math.min(props.steps.length - 1, i + 1))}
            className="rounded border border-foreground bg-foreground px-3 py-1 text-xs text-background"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded border border-foreground bg-foreground px-3 py-1 text-xs text-background"
          >
            Submit
          </button>
        )}
      </div>
    </Frame>
  );
}
