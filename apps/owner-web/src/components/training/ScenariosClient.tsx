'use client';

/**
 * <ScenariosClient> — the interactive scenario-simulation island (gap 9).
 *
 * Reads the admin-locked role-mode deep-link (`?roleMode=<mode>`), narrows it
 * to the known allowlist (the SERVER is authoritative — it rejects a mismatch
 * with 403, rendered as a graceful state), and swaps between the scenario
 * browser and the live workspace. Wrapped in <Suspense> by the page because
 * `useSearchParams` requires it.
 */

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ScenarioView, ScenarioRoleMode, ScenarioLanguage } from '@borjie/api-client/training-types';
import { ROLE_MODES, trainingT } from '@/i18n/strings/training';
import { ScenarioBrowser } from './ScenarioBrowser';
import { ScenarioWorkspace } from './ScenarioWorkspace';
import { TrainingProvider } from './training-mode-context';
import { TrainingNav } from './TrainingNav';

interface ScenariosClientProps {
  readonly locale: ScenarioLanguage;
}

/** Narrow a raw query value to a known role-mode (server is authoritative). */
function parseRoleMode(raw: string | null): ScenarioRoleMode | null {
  if (!raw) return null;
  return (ROLE_MODES as readonly string[]).includes(raw)
    ? (raw as ScenarioRoleMode)
    : null;
}

export function ScenariosClient({ locale }: ScenariosClientProps) {
  return (
    <Suspense fallback={null}>
      <ScenariosClientInner locale={locale} />
    </Suspense>
  );
}

function ScenariosClientInner({ locale }: ScenariosClientProps) {
  const tr = trainingT(locale);
  const searchParams = useSearchParams();
  const deepLinkRoleMode = useMemo(
    () => parseRoleMode(searchParams?.get('roleMode') ?? null),
    [searchParams],
  );

  const [active, setActive] = useState<ScenarioView | null>(null);

  const lockedRoleModeLabel = deepLinkRoleMode ? tr.roleLabel(deepLinkRoleMode) : null;

  return (
    <div className="space-y-5">
      <TrainingNav locale={locale} />

      <TrainingProvider genericErrorMessage={tr.t('genericError')}>
        {active ? (
          <ScenarioWorkspace
            scenario={active}
            roleMode={deepLinkRoleMode}
            locale={locale}
            onExit={() => setActive(null)}
          />
        ) : (
          <ScenarioBrowser
            locale={locale}
            onSelect={setActive}
            lockedRoleModeLabel={lockedRoleModeLabel}
          />
        )}
      </TrainingProvider>
    </div>
  );
}
