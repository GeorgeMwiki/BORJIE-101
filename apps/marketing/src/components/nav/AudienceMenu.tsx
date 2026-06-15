'use client';

import Link from 'next/link';
import type { AudienceCategory, NavMessages } from './types';

export type { AudienceCategory } from './types';

interface AudienceMenuProps {
  readonly id: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly categories: readonly AudienceCategory[];
  readonly messages: NavMessages;
  readonly pathname: string;
}

/**
 * Desktop "Who we serve" panel — a crisp, column-aligned disclosure of
 * the audience matrix. Progressive disclosure keeps the top bar lean
 * while the full segment list stays one click away. The panel mounts
 * only while open; Escape / outside-click / route-change handling and
 * focus-return live on the trigger in `Nav.tsx`.
 */
export function AudienceMenu({
  id,
  open,
  onClose,
  categories,
  messages,
  pathname,
}: AudienceMenuProps) {
  if (!open) return null;

  const cats = messages.categories;
  const items = messages.items;

  return (
    <div
      id={id}
      className="absolute left-1/2 top-full mt-2 w-cmd -translate-x-1/2 rounded-xl border border-border bg-card p-2 shadow-lift-medium"
    >
      <div className="grid grid-cols-4 gap-1">
        {categories.map((cat) => (
          <div key={cat.titleKey} className="p-1">
            <div className="mb-1 px-2 py-1 text-tiny font-semibold uppercase tracking-widest text-foreground/55">
              {cats[cat.titleKey]}
            </div>
            <ul className="space-y-0.5">
              {cat.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const titleKey = item.id as keyof typeof items;
                const descKey = `${item.id}Desc` as keyof typeof items;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={isActive ? 'page' : undefined}
                      className={[
                        'group flex items-start gap-2.5 rounded-lg p-2 transition-colors duration-150 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                        isActive ? 'bg-surface-raised' : 'hover:bg-surface-raised',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          isActive
                            ? 'bg-signal-500 text-primary-foreground'
                            : 'bg-surface-raised text-foreground/60 group-hover:text-signal-500',
                        ].join(' ')}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight text-foreground">
                          {items[titleKey]}
                        </span>
                        <span className="mt-0.5 block text-badge leading-snug text-foreground/60">
                          {items[descKey]}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
