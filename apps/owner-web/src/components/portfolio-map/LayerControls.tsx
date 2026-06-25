'use client';

import type { FeatureKind } from '@/lib/types/portfolio-map';
import { pickByLocale } from '@/lib/locale';
import type { Locale } from '@/lib/locale-shared';
import { layerToggleLabels } from '@/i18n/strings/portfolio-map';

interface LayerControlsProps {
  readonly enabled: ReadonlyArray<FeatureKind>;
  readonly onToggle: (kind: FeatureKind) => void;
  readonly locale: Locale;
}

const LAYER_ORDER: ReadonlyArray<FeatureKind> = [
  'licence',
  'site',
  'settlement',
  'water',
  'protected',
  'road',
];

export function LayerControls({ enabled, onToggle, locale }: LayerControlsProps) {
  return (
    <ul className="space-y-1.5 text-sm">
      {LAYER_ORDER.map((kind) => {
        const on = enabled.includes(kind);
        return (
          <li key={kind}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(kind)}
                className="accent-warning"
              />
              <span className={on ? 'text-foreground' : 'text-muted-foreground'}>
                {pickByLocale(locale, layerToggleLabels[kind])}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
