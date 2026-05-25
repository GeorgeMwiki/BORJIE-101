'use client';

import { useState } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { SETTINGS_MOCK } from '@/lib/mocks/commercial';
import { Toast } from '@/components/shared/Toast';

const AUTONOMY_LEVELS = ['advise', 'propose', 'execute-with-approval', 'execute-autonomously'] as const;

/**
 * O-W-22 — Settings. Polished stub with: users table, plan card,
 * autonomy policy table where each row's autonomy level is editable
 * (working action: select dispatches a toast confirming the change).
 */
type AutonomyEntry = { readonly agent: string; readonly level: string };

export default function SettingsPage() {
  const [autonomy, setAutonomy] = useState<AutonomyEntry[]>(
    () => SETTINGS_MOCK.autonomy.map((a) => ({ agent: a.agent, level: a.level })),
  );
  const [toast, setToast] = useState<string | null>(null);

  const updateLevel = (agent: string, level: string): void => {
    setAutonomy((prev) =>
      prev.map((a) => (a.agent === agent ? { agent, level } : a)),
    );
    setToast(`${agent} autonomy set to ${level}`);
  };

  return (
    <>
      <ScreenHeader slug="settings" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Users & roles (RBAC)">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Name</th>
                <th className="py-1 text-left">Role</th>
                <th className="py-1 text-left">Email</th>
              </tr>
            </thead>
            <tbody>
              {SETTINGS_MOCK.users.map((u) => (
                <tr key={u.email} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{u.name}</td>
                  <td className="py-1.5 text-neutral-300">{u.role}</td>
                  <td className="py-1.5 font-mono text-xs text-neutral-400">
                    {u.email}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Plan & billing">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-neutral-500">Tier</dt>
            <dd className="text-foreground">{SETTINGS_MOCK.plan.tier}</dd>
            <dt className="text-neutral-500">Seats</dt>
            <dd className="text-foreground">{SETTINGS_MOCK.plan.seats}</dd>
            <dt className="text-neutral-500">Renews</dt>
            <dd className="text-foreground">{SETTINGS_MOCK.plan.renewsAt}</dd>
          </dl>
        </SectionCard>
        <SectionCard title="Autonomy policy" className="md:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-neutral-500">
                <th className="py-1 text-left">Agent</th>
                <th className="py-1 text-left">Level</th>
              </tr>
            </thead>
            <tbody>
              {autonomy.map((a) => (
                <tr key={a.agent} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{a.agent}</td>
                  <td className="py-1.5">
                    <select
                      value={a.level}
                      onChange={(e) => updateLevel(a.agent, e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    >
                      {AUTONOMY_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </div>
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
