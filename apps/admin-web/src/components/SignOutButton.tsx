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
        <span role="alert" className="text-xs text-rose-400">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={
          props.className ??
          'rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500 hover:text-foreground disabled:opacity-60'
        }
      >
        {pending ? 'Signing out…' : (props.label ?? 'Sign out')}
      </button>
    </div>
  );
}
