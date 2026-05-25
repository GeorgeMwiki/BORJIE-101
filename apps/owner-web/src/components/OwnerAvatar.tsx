interface OwnerAvatarProps {
  readonly fullName: string;
  readonly tenantName: string;
}

/**
 * Owner identity strip in the top bar.
 *
 * Two lines on purpose: full name (who is signed in) and tenant
 * trading name (which company am I currently in). The latter
 * matters for owners running multiple legal entities — a misclick
 * into the wrong tenant is one of the easier mistakes to make.
 */
export function OwnerAvatar({ fullName, tenantName }: OwnerAvatarProps) {
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex items-center gap-2.5">
      <div className="text-right leading-tight">
        <div className="text-sm font-medium text-foreground">{fullName}</div>
        <div className="text-xs text-neutral-400">{tenantName}</div>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-warning to-signal-500 text-sm font-semibold text-background">
        {initials}
      </div>
    </div>
  );
}
