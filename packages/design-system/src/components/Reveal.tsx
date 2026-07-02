import * as React from 'react';
import { cn } from '../lib/utils';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Reveal / RevealGroup
 * --------------------
 * IntersectionObserver-driven scroll-reveal primitives. Children begin
 * translated + faded, then settle to their resting position the first time
 * they enter the viewport ("reveal once" — no re-hide on scroll-out).
 *
 * Motion is entirely TOKEN-DRIVEN: the transition duration and easing resolve
 * to the design system's `--duration-*` / `--ease-*` custom properties. No
 * hardcoded milliseconds or bezier curves live here.
 *
 * Reduced-motion is a FIRST-CLASS path, not an afterthought: when the user
 * prefers reduced motion (or the environment has no IntersectionObserver), the
 * content renders immediately in its resting state with zero transform and no
 * transition — nothing ever animates.
 *
 * These are the substrate Wave 3's chat choreography consumes; keep them
 * dependency-free and composable.
 */

export type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

type MotionToken = 'fast' | 'base' | 'slow' | 'slower';
type EaseToken = 'out' | 'in' | 'in-out' | 'spring';

const DURATION_VAR: Record<MotionToken, string> = {
  fast: 'var(--duration-fast)',
  base: 'var(--duration-base)',
  slow: 'var(--duration-slow)',
  slower: 'var(--duration-slower)',
};

const EASE_VAR: Record<EaseToken, string> = {
  out: 'var(--ease-out)',
  in: 'var(--ease-in)',
  'in-out': 'var(--ease-in-out)',
  spring: 'var(--ease-spring)',
};

/** Resting-to-hidden offset per direction. Distance is a small, fixed nudge. */
function hiddenTransform(direction: RevealDirection, distance: number): string {
  switch (direction) {
    case 'up':
      return `translate3d(0, ${distance}px, 0)`;
    case 'down':
      return `translate3d(0, ${-distance}px, 0)`;
    case 'left':
      return `translate3d(${distance}px, 0, 0)`;
    case 'right':
      return `translate3d(${-distance}px, 0, 0)`;
    case 'none':
    default:
      return 'none';
  }
}

export interface RevealProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Direction the content slides in FROM. Default `up`. */
  direction?: RevealDirection;
  /** Travel distance in px for the slide. Default `16`. */
  distance?: number;
  /** Duration token. Default `slow`. */
  duration?: MotionToken;
  /** Easing token. Default `out`. */
  easing?: EaseToken;
  /** Extra delay in ms before this element settles (used by RevealGroup stagger). */
  delayMs?: number;
  /**
   * `rootMargin` for the observer — how far before the viewport edge the
   * reveal triggers. Default nudges reveals in slightly early.
   */
  rootMargin?: string;
  /** Visibility fraction that triggers the reveal. Default `0.1`. */
  threshold?: number;
  /** Render the wrapper as a different element (kept simple: a div). */
  asChild?: never;
}

export const Reveal = React.forwardRef<HTMLDivElement, RevealProps>(
  (
    {
      className,
      style,
      children,
      direction = 'up',
      distance = 16,
      duration = 'slow',
      easing = 'out',
      delayMs = 0,
      rootMargin = '0px 0px -8% 0px',
      threshold = 0.1,
      ...rest
    },
    forwardedRef
  ) => {
    const reduced = useReducedMotion();
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = React.useState<boolean>(false);

    // Merge the forwarded ref with our internal observer ref.
    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [forwardedRef]
    );

    React.useEffect(() => {
      // Reduced motion or no observer support → reveal immediately, no animation.
      if (
        reduced ||
        typeof window === 'undefined' ||
        typeof IntersectionObserver === 'undefined'
      ) {
        setVisible(true);
        return;
      }

      const node = innerRef.current;
      if (!node) {
        setVisible(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setVisible(true);
              observer.disconnect(); // reveal once
              break;
            }
          }
        },
        { root: null, rootMargin, threshold }
      );

      observer.observe(node);
      return () => observer.disconnect();
    }, [reduced, rootMargin, threshold]);

    // Reduced motion: resting state, no transition property at all.
    const motionStyle: React.CSSProperties = reduced
      ? { opacity: 1, transform: 'none' }
      : {
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : hiddenTransform(direction, distance),
          transitionProperty: 'opacity, transform',
          transitionDuration: DURATION_VAR[duration],
          transitionTimingFunction: EASE_VAR[easing],
          transitionDelay: delayMs ? `${delayMs}ms` : undefined,
          willChange: visible ? undefined : 'opacity, transform',
        };

    return (
      <div
        ref={setRefs}
        className={cn(className)}
        style={{ ...motionStyle, ...style }}
        {...rest}
      >
        {children}
      </div>
    );
  }
);
Reveal.displayName = 'Reveal';

export interface RevealGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Per-child stagger increment in ms. Default `70`. Ignored under reduced motion. */
  stagger?: number;
  /** Direction passed to each child Reveal. Default `up`. */
  direction?: RevealDirection;
  /** Travel distance passed to each child. Default `16`. */
  distance?: number;
  /** Duration token passed to each child. Default `slow`. */
  duration?: MotionToken;
  /** Easing token passed to each child. Default `out`. */
  easing?: EaseToken;
}

/**
 * RevealGroup — wraps each direct child in a Reveal with an incrementing
 * `delayMs`, producing a staggered cascade. Under reduced motion the stagger
 * collapses to zero (each child reveals immediately) because Reveal itself
 * ignores delay in that path.
 */
export const RevealGroup = React.forwardRef<HTMLDivElement, RevealGroupProps>(
  (
    {
      className,
      children,
      stagger = 70,
      direction = 'up',
      distance = 16,
      duration = 'slow',
      easing = 'out',
      ...rest
    },
    ref
  ) => {
    const items = React.Children.toArray(children);

    return (
      <div ref={ref} className={cn(className)} {...rest}>
        {items.map((child, index) => (
          <Reveal
            // Stable-enough key: index is acceptable for a static reveal list.
            key={index}
            direction={direction}
            distance={distance}
            duration={duration}
            easing={easing}
            delayMs={index * stagger}
          >
            {child}
          </Reveal>
        ))}
      </div>
    );
  }
);
RevealGroup.displayName = 'RevealGroup';

export default Reveal;
