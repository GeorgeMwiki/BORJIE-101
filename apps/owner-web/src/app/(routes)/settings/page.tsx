import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-22 — Settings.
 *
 * Users, roles, plan, billing, autonomy policy. The autonomy policy
 * is the owner's slider for "what may agents do without my
 * approval?" — defaults are conservative (advise only) and the
 * owner unlocks specific actions per agent.
 */
export default function SettingsPage() {
  return (
    <>
      <ScreenHeader slug="settings" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <PlaceholderCard title="Users & roles (RBAC)">
          Invite users, assign roles (owner, manager, supervisor, lab,
          accountant, viewer). Per-role tool whitelist.
        </PlaceholderCard>
        <PlaceholderCard title="Plan & billing">
          Current plan (`mtu_mmoja` / `kampuni` / `group`), seat count,
          invoice history, upgrade path.
        </PlaceholderCard>
        <PlaceholderCard title="Autonomy policy">
          Per-agent autonomy: advise / propose / execute-with-approval /
          execute-autonomously. Owner-only edit.
        </PlaceholderCard>
        <PlaceholderCard title="Audit log">
          Read-only feed of every meaningful change. Export for the
          auditor.
        </PlaceholderCard>
      </div>
    </>
  );
}
