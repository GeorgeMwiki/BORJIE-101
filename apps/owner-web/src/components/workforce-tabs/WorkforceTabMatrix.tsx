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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import { apiRequest } from '@/lib/api-client';
import { tailStrings as S } from '@/i18n/strings/tail';

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

const M = S.workforceTabMatrix;

const COPY = {
  en: {
    title: M.title.en,
    description: M.description.en,
    role: M.role.en,
    scope: M.scope.en,
    density: M.density.en,
    densityComfortable: M.densityComfortable.en,
    densityCompact: M.densityCompact.en,
    saving: M.saving.en,
    saved: M.saved.en,
    error: M.error.en,
    locked: M.locked.en,
    notAllowedForRole: M.notAllowedForRole.en,
  },
  sw: {
    title: M.title.sw,
    description: M.description.sw,
    role: M.role.sw,
    scope: M.scope.sw,
    density: M.density.sw,
    densityComfortable: M.densityComfortable.sw,
    densityCompact: M.densityCompact.sw,
    saving: M.saving.sw,
    saved: M.saved.sw,
    error: M.error.sw,
    locked: M.locked.sw,
    notAllowedForRole: M.notAllowedForRole.sw,
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
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{copy.role}</TableHead>
              <TableHead>{copy.scope}</TableHead>
              {WORKFORCE_TAB_CATALOG.map((tab) => (
                <TableHead key={tab.id} className="text-center" title={tab.id}>
                  {props.isSw ? tab.label.sw : tab.label.en}
                </TableHead>
              ))}
              <TableHead>{copy.density}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {WORKFORCE_ROLE_IDS.map((role) =>
              props.siteScopes.map((scope) => {
                const enabled = new Set(resolveEnabled(role, scope.id));
                const allowedForRole = new Set(
                  listTabsAllowedForRole(role).map((t) => t.id),
                );
                const density = resolveDensity(role, scope.id);
                return (
                  <TableRow key={`${role}::${scope.id}`}>
                    <TableCell className="font-medium text-foreground">
                      {role}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {scope.label}
                    </TableCell>
                    {WORKFORCE_TAB_CATALOG.map((tab) => {
                      const allowed = allowedForRole.has(tab.id);
                      const isChecked = enabled.has(tab.id);
                      const isMandatory =
                        MANDATORY_WORKFORCE_TAB_IDS.includes(tab.id);
                      const cellKey = `${role}::${scope.id}::${tab.id}`;
                      const saving = savingCell === cellKey;
                      if (!allowed) {
                        return (
                          <TableCell
                            key={tab.id}
                            className="text-center text-muted-foreground/40"
                            aria-label={copy.notAllowedForRole}
                          >
                            —
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={tab.id} className="text-center">
                          <label className="inline-flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer rounded border-input accent-signal-500"
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
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <Select
                        value={density}
                        disabled={savingCell === `${role}::${scope.id}::density`}
                        onValueChange={(v) =>
                          void onDensityChange(
                            role as WorkforceRoleId,
                            scope.id,
                            v as 'comfortable' | 'compact',
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="comfortable">
                            {copy.densityComfortable}
                          </SelectItem>
                          <SelectItem value="compact">
                            {copy.densityCompact}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </div>
      {upsertMutation.isError ? (
        <p className="mt-3 text-xs text-destructive">{copy.error}</p>
      ) : null}
    </section>
  );
}
