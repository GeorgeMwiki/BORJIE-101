'use client';

import type { FeatureKind } from '@/lib/mocks/portfolio-map';

interface LayerControlsProps {
  readonly enabled: ReadonlyArray<FeatureKind>;
  readonly onToggle: (kind: FeatureKind) => void;
}

const LAYERS: ReadonlyArray<{ readonly id: FeatureKind; readonly label: string }> = [
  { id: 'licence', label: 'Licences' },
  { id: 'site', label: 'Sites' },
  { id: 'settlement', label: 'Settlements' },
  { id: 'water', label: 'Water' },
  { id: 'protected', label: 'Protected areas' },
  { id: 'road', label: 'Roads' },
];

export function LayerControls({ enabled, onToggle }: LayerControlsProps) {
  return (
    <ul className="space-y-1.5 text-sm">
      {LAYERS.map((layer) => {
        const on = enabled.includes(layer.id);
        return (
          <li key={layer.id}>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(layer.id)}
                className="accent-warning"
              />
              <span className={on ? 'text-foreground' : 'text-neutral-500'}>
                {layer.label}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
