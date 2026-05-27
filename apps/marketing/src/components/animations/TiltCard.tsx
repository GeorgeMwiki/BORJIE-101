'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * TiltCard — 3D rotateX/rotateY tilt that follows the mouse, capped at
 * 6deg with a 1000px perspective. Disabled (no tilt, no transition) when
 * the user has `prefers-reduced-motion: reduce` set or on coarse-pointer
 * devices (touch) so we never trigger nausea or fight tap surfaces.
 */
export interface TiltCardProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly maxTilt?: number;
}

interface TiltState {
  readonly rx: number;
  readonly ry: number;
}

const REST: TiltState = { rx: 0, ry: 0 };

export function TiltCard({ children, className = '', maxTilt = 6 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState<TiltState>(REST);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    setEnabled(!(reducedMotion || coarsePointer));
  }, []);

  if (!enabled) {
    return (
      <div className={className} ref={ref}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      onMouseMove={(event) => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        setTilt({ rx: -y * maxTilt * 2, ry: x * maxTilt * 2 });
      }}
      onMouseLeave={() => setTilt(REST)}
      className={className}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg)`,
        transition: 'transform 120ms ease-out',
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  );
}
