'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@borjie/design-system';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { dictionaries } from '@/i18n/dictionaries';
import { makeT } from '@/i18n/resolve';

/**
 * Sign-out button for the Borjie Owner Cockpit top bar.
 *
 * Calls `supabase.auth.signOut()` then forces a router refresh so
 * the middleware re-runs and the user gets bounced to `/sign-in`.
 *
 * Always-on chrome: the label, the pending state, and the catch-all
 * error all resolve off the ACTIVE locale passed in via `lang` (default
 * 'en'), so the control never leaks the inactive language.
 */
export function SignOutButton(props: {
  readonly className?: string;
  readonly label?: string;
  readonly lang?: 'sw' | 'en';
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = useMemo(() => makeT(dictionaries[props.lang ?? 'en']), [props.lang]);

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
        setError(err instanceof Error ? err.message : t('signOut.error'));
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        loading={pending}
        className={
          props.className ??
          'gap-1.5 bg-card/60 font-medium text-muted-foreground hover:border-border-strong hover:bg-muted/50 hover:text-foreground'
        }
      >
        {pending ? t('signOut.pending') : (props.label ?? t('signOut.action'))}
      </Button>
    </div>
  );
}
