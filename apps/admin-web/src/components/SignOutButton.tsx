'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Sign-out button for the Borjie Console top nav.
 *
 * Calls `supabase.auth.signOut()` then forces a router refresh so the
 * middleware re-runs and the user gets bounced to `/sign-in`. Wrap
 * with whatever nav container the rest of the design system uses;
 * the styling here is intentionally minimal so the button drops into
 * any header.
 */
export function SignOutButton(props: {
  readonly className?: string;
  readonly label?: string;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          setError(signOutError.message);
          return;
        }
        router.replace('/sign-in');
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Sign-out failed',
        );
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={
          props.className ??
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60'
        }
      >
        {pending ? 'Signing out…' : (props.label ?? 'Sign out')}
      </button>
    </div>
  );
}
