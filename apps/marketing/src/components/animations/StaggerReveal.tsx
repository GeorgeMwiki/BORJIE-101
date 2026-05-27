'use client';

import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * StaggerReveal — children fade up 8px with a 60ms stagger when the
 * container enters the viewport. Triggered once via IntersectionObserver.
 * Each direct child is wrapped in a div carrying the per-child delay; if
 * the user has `prefers-reduced-motion` set we render children inline
 * with no transform and no delay.
 */
export interface StaggerRevealProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly stagger?: number;
  readonly y?: number;
}

export function StaggerReveal({
  children,
  className = '',
  stagger = 60,
  y = 8,
}: StaggerRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  const items = Children.toArray(children);

  return (
    <div ref={ref} className={className}>
      {items.map((child, index) => {
        const key = isValidElement(child) && child.key != null ? child.key : index;
        const delay = reducedMotion ? 0 : index * stagger;
        const transform = reducedMotion
          ? 'none'
          : visible
            ? 'translateY(0)'
            : `translateY(${y}px)`;
        return (
          <div
            key={key}
            style={{
              opacity: reducedMotion ? 1 : visible ? 1 : 0,
              transform,
              transition: reducedMotion
                ? 'none'
                : `opacity 520ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 520ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
              willChange: reducedMotion ? 'auto' : 'opacity, transform',
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
