'use client';

import { useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import type { SiteSummary } from '@/lib/session';

interface SiteSelectorProps {
  readonly sites: ReadonlyArray<SiteSummary>;
  readonly activeSiteId: string;
}

/**
 * Site selector — the single most-used control on this surface.
 *
 * Owners run multiple sites; almost every other page silently scopes
 * to the chosen site. Keeping this control in the top bar means the
 * scope is visible at all times, never hidden inside a settings page.
 *
 * Client island because the dropdown is interactive; the parent
 * server component still owns session resolution.
 */
export function SiteSelector({ sites, activeSiteId }: SiteSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(activeSiteId);
  const selected = sites.find((s) => s.id === selectedId) ?? sites[0];
  if (!selected) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-surface/70"
      >
        <MapPin className="h-4 w-4 text-neutral-400" />
        <span className="font-medium">{selected.name}</span>
        <span className="text-xs text-neutral-500">· {selected.region}</span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          <ul className="py-1">
            {sites.map((site) => (
              <li key={site.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(site.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface/70 ${
                    site.id === selectedId
                      ? 'text-foreground'
                      : 'text-neutral-300'
                  }`}
                >
                  <MapPin className="mt-0.5 h-4 w-4 text-neutral-500" />
                  <span className="flex-1">
                    <span className="block font-medium">{site.name}</span>
                    <span className="block text-xs text-neutral-500">
                      {site.region} · {site.mineral} · {site.status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
