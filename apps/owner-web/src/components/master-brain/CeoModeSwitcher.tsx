'use client';

import { useState } from 'react';
import { CEO_MODES, type CeoModeId } from '@/lib/ceo-modes';

interface CeoModeSwitcherProps {
  readonly initialMode?: CeoModeId;
}

/**
 * 8 CEO-mode persona switcher for the Master Brain chat.
 *
 * Switches the system prompt + tool surface bound to the next chat
 * turn. The blurb and sample prompts are rendered alongside so the
 * owner sees, immediately, what this mode is good for — no hidden
 * dialog or settings page required.
 *
 * Each switch is local state today; in the live system it will POST
 * to /api/owner/brain/mode and the chosen mode rides on every
 * subsequent turn until the owner changes it.
 */
export function CeoModeSwitcher({ initialMode = 'strategy' }: CeoModeSwitcherProps) {
  const [activeId, setActiveId] = useState<CeoModeId>(initialMode);
  const active = CEO_MODES.find((m) => m.id === activeId);
  if (!active) return null;
  return (
    <section className="rounded-lg border border-border bg-surface/40 p-5">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Master Brain · CEO modes
      </div>
      <div className="flex flex-wrap gap-2">
        {CEO_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setActiveId(mode.id)}
            aria-pressed={mode.id === activeId}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              mode.id === activeId
                ? 'border-warning bg-warning-subtle/30 text-warning'
                : 'border-border bg-surface text-neutral-300 hover:text-foreground'
            }`}
          >
            {mode.label}
            <span className="ml-1.5 text-[10px] text-neutral-500">
              · {mode.labelSw}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="md:col-span-1">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Persona
          </div>
          <div className="mt-1 text-base font-display text-foreground">
            {active.label}
          </div>
          <p className="mt-2 text-sm text-neutral-300">{active.blurb}</p>
          <div className="mt-3 text-xs text-neutral-500">
            Tools: {active.toolsSummary}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Try
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {active.samplePrompts.map((prompt, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-neutral-200"
              >
                {prompt}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
