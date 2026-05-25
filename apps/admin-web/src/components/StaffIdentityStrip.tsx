import { cookies } from 'next/headers';
import { PLATFORM_SESSION_COOKIE, type PlatformStaff } from '@/lib/session';

async function fetchMe(cookieHeader: string): Promise<PlatformStaff | null> {
  try {
    const base = process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL ?? 'http://localhost:3020';
    const res = await fetch(`${base}/api/platform/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { staff?: PlatformStaff };
    return data.staff ?? null;
  } catch (error) {
    console.error('StaffIdentityStrip me fetch failed:', error);
    return null;
  }
}

export async function StaffIdentityStrip() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const sessionPresent = Boolean(cookieStore.get(PLATFORM_SESSION_COOKIE)?.value);
  const staff = sessionPresent ? await fetchMe(cookieHeader) : null;

  if (!staff) {
    return (
      <div className="text-xs text-warning">
        Identity service unreachable
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end">
        <span className="text-sm font-medium text-foreground">{staff.name}</span>
        <span className="text-xs text-neutral-500">
          {staff.roles.join(' · ')}
        </span>
      </div>
      <div className="w-9 h-9 rounded-full bg-signal-500/20 border border-signal-500/40 flex items-center justify-center text-sm font-medium text-signal-500">
        {staff.name.slice(0, 1).toUpperCase()}
      </div>
    </div>
  );
}
