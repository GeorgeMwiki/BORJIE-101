import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * StaffIdentityStrip — the operator persona chip in the admin top bar.
 *
 * Sourced from the canonical Supabase session that already gates every
 * admin-web page (the same session middleware refreshes on navigation),
 * NOT a separate identity service. The standalone identity service was
 * removed in the hard-fork, so the old PLATFORM_SESSION_COOKIE +
 * /api/platform/me path could never resolve and the chip rendered a
 * permanent "Identity service unreachable" warning. When no user is
 * signed in we render a neutral signed-out state rather than alarming
 * copy.
 */

interface StaffIdentity {
  readonly name: string;
  readonly roles: ReadonlyArray<string>;
}

function deriveIdentity(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): StaffIdentity {
  const meta = user.user_metadata ?? {};
  const appMeta = user.app_metadata ?? {};
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    user.email ||
    'Staff';

  const rolesRaw =
    appMeta.roles ?? appMeta.platform_roles ?? appMeta.role ?? meta.role;
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.filter((r): r is string => typeof r === 'string')
    : typeof rolesRaw === 'string'
      ? [rolesRaw]
      : [];

  return { name, roles };
}

export async function StaffIdentityStrip() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <div className="text-xs text-neutral-500">Signed out</div>;
  }

  const identity = deriveIdentity(user);
  const initial = identity.name.slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium text-foreground">
          {identity.name}
        </span>
        {identity.roles.length > 0 ? (
          <span className="text-xs text-neutral-500">
            {identity.roles.join(' · ')}
          </span>
        ) : null}
      </div>
      <div className="w-9 h-9 rounded-full bg-signal-500/20 border border-signal-500/40 flex items-center justify-center text-sm font-medium text-signal-500">
        {initial}
      </div>
    </div>
  );
}
