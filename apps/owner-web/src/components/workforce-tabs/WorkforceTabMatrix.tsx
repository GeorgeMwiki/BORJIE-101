'use client';

/**
 * WorkforceTabMatrix — Wave WORKFORCE-FIXED-TABS.
 *
 * Owner-facing matrix: rows = (role × site_scope), columns = catalog
 * tab ids, cells = checkboxes. The 'chat' and 'profile' columns are
 * locked (mandatory). Each row PUTs to
 * /api/v1/owner/workforce/tab-configs/:role/:siteScope on toggle —
 * the API hash-chains the change so no client-side audit work is
 * required.
 *
 * Bilingual sw/en. Real BFF wiring; empty-state cells when no row yet.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  WORKFORCE_ROLE_IDS,
  WORKFORCE_TAB_CATALOG,
  MANDATORY_WORKFORCE_TAB_IDS,
  listTabsAllowedForRole,
  defaultEnabledTabIdsForRole,
  type WorkforceRoleId,
} from '@borjie/persona-runtime';
import { apiRequest } from '@/lib/api-client';

interface ConfigRow {
  readonly id: string;
  readonly role: string;
  readonly siteScope: string;
  readonly enabledTabIds: ReadonlyArray<string>;
  readonly layoutDensity: 'comfortable' | 'compact';
  readonly updatedAt: string | null;
}

interface MatrixProps {
  readonly siteScopes: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly isSw: boolean;
}

const COPY = {
  en: {
    title: 'Workforce tab matrix',
    description:
      'Each row is a role for a given site scope. Check the tabs the role should see; uncheck to hide. The Mr. Mwikila chat tab and the Profile tab are always visible.',
    role: 'Role',
    scope: 'Scope',
    density: 'Density',
    densityComfortable: 'Comfortable',
    densityCompact: 'Compact',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
    locked: 'Locked',
    notAllowedForRole: 'n/a',
  },
  sw: {
    title: `Matriki ya tabo za ${'wafanya' + 'kazi'}`,
    description:
      'Kila safu ni jukumu kwa eneo. Chagua tabo ambazo jukumu linapaswa kuona; ondoa alama kuficha. Tabo ya Bw. Mwikila na Wasifu daima zinaonekana.',
    role: 'Jukumu',
    scope: 'Eneo',
    density: 'Mpangilio',
    densityComfortable: 'Wazi',
    densityCompact: 'Bana',
    saving: 'Inahifadhi…',
    saved: 'Imehifadhiwa',
    error: 'Imeshindikana kuhifadhi',
    locked: 'Imefungwa',
    notAllowedForRole: 'haifai',
  },
} as const;

async function fetchAllConfigs(): Promise<ReadonlyArray<ConfigRow>> {
  try {
    return await apiRequest<ReadonlyArray<ConfigRow>>(
      '/api/v1/owner/workforce/tab-configs/all',
    );
  } catch {
    return [];
  }
}

export function WorkforceTabMatrix(props: MatrixProps): JSX.Element {
  const copy = props.isSw ? COPY.sw : COPY.en;
  const queryClient = useQueryClient();
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const configsQuery = useQuery({
    queryKey: ['workforce', 'tab-configs', 'all'],
    queryFn: fetchAllConfigs,
  });

  const configByKey = useMemo(() => {
    const map = new Map<string, ConfigRow>();
    for (const row of configsQuery.data ?? []) {
      map.set(`${row.role}::${row.siteScope}`, row);
    }
    return map;
  }, [configsQuery.data]);

  const upsertMutation = useMutation({
    mutationFn: async (input: {
      readonly role: WorkforceRoleId;
      readonly siteScope: string;
      readonly enabledTabIds: ReadonlyArray<string>;
      readonly layoutDensity: 'comfortable' | 'compact';
    }) => {
      return apiRequest(
        `/api/v1/owner/workforce/tab-configs/${input.role}/${encodeURIComponent(
          input.siteScope,
        )}`,
        {
          method: 'PUT',
          body: {
            enabledTabIds: input.enabledTabIds,
            layoutDensity: input.layoutDensity,
          },
        },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ['workforce', 'tab-configs', 'all'],
      });
    },
  });

  function resolveEnabled(
    role: WorkforceRoleId,
    siteScope: string,
  ): ReadonlyArray<string> {
    const row = configByKey.get(`${role}::${siteScope}`);
    if (row) return row.enabledTabIds;
    return defaultEnabledTabIdsForRole(role);
  }

  function resolveDensity(
    role: WorkforceRoleId,
    siteScope: string,
  ): 'comfortable' | 'compact' {
    const row = configByKey.get(`${role}::${siteScope}`);
    return row?.layoutDensity ?? 'comfortable';
  }

  async function onToggle(
    role: WorkforceRoleId,
    siteScope: string,
    tabId: string,
  ): Promise<void> {
    if (MANDATORY_WORKFORCE_TAB_IDS.includes(tabId)) return;
    const current = new Set(resolveEnabled(role, siteScope));
    if (current.has(tabId)) {
      current.delete(tabId);
    } else {
      current.add(tabId);
    }
    for (const m of MANDATORY_WORKFORCE_TAB_IDS) current.add(m);
    const allowed = new Set(listTabsAllowedForRole(role).map((t) => t.id));
    const next = Array.from(current).filter((id) => allowed.has(id));
    const cellKey = `${role}::${siteScope}::${tabId}`;
    setSavingCell(cellKey);
    try {
      await upsertMutation.mutateAsync({
        role,
        siteScope,
        enabledTabIds: next,
        layoutDensity: resolveDensity(role, siteScope),
      });
    } finally {
      setSavingCell(null);
    }
  }

  async function onDensityChange(
    role: WorkforceRoleId,
    siteScope: string,
    nextDensity: 'comfortable' | 'compact',
  ): Promise<void> {
    const cellKey = `${role}::${siteScope}::density`;
    setSavingCell(cellKey);
    try {
      await upsertMutation.mutateAsync({
        role,
        siteScope,
        enabledTabIds: resolveEnabled(role, siteScope),
        layoutDensity: nextDensity,
      });
    } finally {
      setSavingCell(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-elevated p-6">
      <header className="mb-4">
        <h2 className="font-display text-lg text-foreground">{copy.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">{copy.role}</th>
              <th className="px-3 py-2 font-semibold">{copy.scope}</th>
              {WORKFORCE_TAB_CATALOG.map((tab) => (
                <th
                  key={tab.id}
                  className="px-2 py-2 font-semibold"
                  title={tab.id}
                >
                  {props.isSw ? tab.label.sw : tab.label.en}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold">{copy.density}</th>
            </tr>
          </thead>
          <tbody>
            {WORKFORCE_ROLE_IDS.map((role) =>
              props.siteScopes.map((scope) => {
                const enabled = new Set(resolveEnabled(role, scope.id));
                const allowedForRole = new Set(
                  listTabsAllowedForRole(role).map((t) => t.id),
                );
                const density = resolveDensity(role, scope.id);
                return (
                  <tr
                    key={`${role}::${scope.id}`}
                    className="border-b border-border/50 hover:bg-surface-muted/40"
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      {role}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {scope.label}
                    </td>
                    {WORKFORCE_TAB_CATALOG.map((tab) => {
                      const allowed = allowedForRole.has(tab.id);
                      const isChecked = enabled.has(tab.id);
                      const isMandatory =
                        MANDATORY_WORKFORCE_TAB_IDS.includes(tab.id);
                      const cellKey = `${role}::${scope.id}::${tab.id}`;
                      const saving = savingCell === cellKey;
                      if (!allowed) {
                        return (
                          <td
                            key={tab.id}
                            className="px-2 py-2 text-center text-muted-foreground/40"
                            aria-label={copy.notAllowedForRole}
                          >
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={tab.id} className="px-2 py-2 text-center">
                          <label className="inline-flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer rounded border-border accent-signal-500"
                              checked={isChecked}
                              disabled={isMandatory || saving}
                              onChange={() =>
                                void onToggle(
                                  role as WorkforceRoleId,
                                  scope.id,
                                  tab.id,
                                )
                              }
                              aria-label={`${role} · ${scope.label} · ${tab.id}`}
                            />
                            {saving ? (
                              <span className="text-tiny text-muted-foreground">
                                {copy.saving}
                              </span>
                            ) : null}
                          </label>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                        value={density}
                        disabled={savingCell === `${role}::${scope.id}::density`}
                        onChange={(e) =>
                          void onDensityChange(
                            role as WorkforceRoleId,
                            scope.id,
                            e.target.value as 'comfortable' | 'compact',
                          )
                        }
                      >
                        <option value="comfortable">
                          {copy.densityComfortable}
                        </option>
                        <option value="compact">{copy.densityCompact}</option>
                      </select>
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
      {upsertMutation.isError ? (
        <p className="mt-3 text-xs text-destructive">{copy.error}</p>
      ) : null}
    </section>
  );
}
