'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Camera,
  MapPin,
  Mic,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * Hero — Borjie's Live Fabric hero (LitFin IgnitionHero pattern, ported
 * to the Borjie OKLCH navy + gold palette).
 *
 * Two-column rhythm:
 *   LEFT  — pill kicker, claim headline, sub, dual CTA, trust strip
 *   RIGHT — live chat inset playing a 3-turn choreographed Borjie
 *           conversation with framer-motion spring entries staggered
 *           at 400ms / 1800ms / 3200ms. The chat panel mirrors the
 *           Borjie product chrome (gold-gradient header, rounded-3xl
 *           shell, brand mark circle, mini-waveform, composer).
 *
 * No screenshots. The chat is REAL DOM. Honours prefers-reduced-motion
 * by collapsing the staggered spring entries to instant reveals and
 * stopping the waveform animation.
 */

interface ChoreoTurn {
  readonly role: 'ai' | 'user';
  readonly body: string;
  readonly timestamp: string;
  readonly delay: number;
}

const DELAYS: readonly number[] = [400, 1800, 3200];

/* The Borjie brand mark — gold radial gradient orb that anchors the AI
   bubbles and the chat header. Matches the LitFin LitfinMark slot. */
function BorjieMark({ size = 22 }: { readonly size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 30% 30%, oklch(0.86 0.16 80 / 0.85), oklch(0.58 0.12 65 / 0.45) 60%, transparent 88%)',
        boxShadow: 'inset 0 0 0 1px oklch(0.78 0.17 78 / 0.35)',
      }}
    />
  );
}

function ChatTurn({
  role,
  body,
  timestamp,
  show,
  reducedMotion,
}: {
  readonly role: 'ai' | 'user';
  readonly body: string;
  readonly timestamp: string;
  readonly show: boolean;
  readonly reducedMotion: boolean;
}) {
  if (!show) return null;
  const isUser = role === 'user';
  const initial = reducedMotion
    ? { opacity: 1, y: 0, x: 0, scale: 1 }
    : { opacity: 0, y: 8, x: isUser ? 12 : -12, scale: 0.97 };
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 320, damping: 24 };

  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
      transition={transition}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`flex gap-2 max-w-[85%] ${
          isUser ? 'flex-row-reverse' : 'flex-row'
        }`}
      >
        {!isUser && (
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, oklch(0.78 0.17 78 / 0.55), oklch(0.58 0.12 65 / 0.25) 60%, transparent 85%)',
              boxShadow: 'inset 0 0 0 1px oklch(0.78 0.17 78 / 0.2)',
            }}
          >
            <BorjieMark size={22} />
          </span>
        )}
        <div className="min-w-0">
          <div
            className={`relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              isUser
                ? 'bg-signal-500/85 text-primary-foreground'
                : 'bg-card/60 text-foreground ring-1 ring-border/40'
            }`}
          >
            {!isUser && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl opacity-70"
                style={{
                  background:
                    'linear-gradient(90deg, oklch(0.86 0.16 80) 0%, oklch(0.78 0.17 78) 55%, oklch(0.58 0.12 65) 100%)',
                }}
              />
            )}
            {body}
          </div>
          <div
            className={`mt-1 flex items-center gap-1.5 px-1 text-[10px] text-neutral-500 ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            <span>{timestamp}</span>
            {!isUser && (
              <Volume2 size={11} className="text-neutral-500/70" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Mini-waveform — 18 animated bars below the chat body suggesting voice
 * input is ready. Pauses when prefers-reduced-motion is set. */
function MiniWaveform({ reducedMotion }: { readonly reducedMotion: boolean }) {
  const bars = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="flex h-4 items-center justify-center gap-[2px]">
      {bars.map((i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="w-[2px] rounded-full"
          style={{ background: 'oklch(0.78 0.17 78 / 0.6)' }}
          animate={
            reducedMotion
              ? { height: 6, opacity: 0.7 }
              : {
                  height: [4, 8 + Math.sin(i) * 4, 4, 12 - Math.cos(i) * 3, 4],
                  opacity: [0.5, 0.9, 0.5, 0.9, 0.5],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  duration: 1.2 + (i % 3) * 0.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.05,
                }
          }
        />
      ))}
    </div>
  );
}

export function Hero({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).hero;
  const chat = t.chat;
  const turns: readonly ChoreoTurn[] = chat.turns.map((turn, i) => ({
    role: turn.role as 'ai' | 'user',
    body: turn.body,
    timestamp: chat.timestamp,
    delay: DELAYS[i] ?? 400 + i * 1400,
  }));

  const [shown, setShown] = useState<boolean[]>(() => turns.map(() => false));
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  useEffect(() => {
    // If reduced motion is on, reveal all turns immediately so the chat
    // reads as a complete static transcript with no choreography.
    if (reducedMotion) {
      setShown(turns.map(() => true));
      return;
    }
    const timers: number[] = [];
    const start = () => {
      turns.forEach((turn, i) => {
        timers.push(
          window.setTimeout(() => {
            setShown((prev) => {
              const next = [...prev];
              next[i] = true;
              return next;
            });
          }, turn.delay),
        );
      });
    };
    let kickoffTimeout: ReturnType<typeof setTimeout> | null = null;
    let listenerAttached = false;
    if (document.readyState === 'complete') {
      kickoffTimeout = setTimeout(start, 0);
    } else {
      window.addEventListener('load', start, { once: true });
      listenerAttached = true;
    }
    return () => {
      if (listenerAttached) window.removeEventListener('load', start);
      if (kickoffTimeout !== null) clearTimeout(kickoffTimeout);
      timers.forEach(window.clearTimeout);
    };
    // We intentionally restart the choreography when reducedMotion flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return (
    <section
      className="relative isolate overflow-hidden"
      aria-labelledby="hero-headline"
    >
      <div className="hero-aurora" aria-hidden="true" />
      <div
        className="absolute inset-0 cinematic-grid opacity-40"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid min-h-[88vh] max-w-7xl grid-cols-1 items-stretch gap-12 px-5 pb-20 pt-16 md:pt-24 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8">
        {/* LEFT — claim + CTAs */}
        <div className="flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-surface/80 px-3 py-1 text-meta font-medium text-neutral-400 backdrop-blur">
            <MapPin className="h-3.5 w-3.5 text-signal-500" aria-hidden="true" />
            <span className="tracking-wide uppercase">{t.pill}</span>
          </span>

          <h1
            id="hero-headline"
            className="mt-6 font-display text-5xl font-medium leading-[1.02] tracking-tighter text-foreground text-balance md:text-6xl lg:text-7xl"
          >
            {t.headline.split(' ').slice(0, -2).join(' ')}{' '}
            <span className="relative inline-block">
              <span className="italic text-signal-500">
                {t.headline.split(' ').slice(-2).join(' ')}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 500 16"
                preserveAspectRatio="none"
                className="absolute -bottom-2 left-0 right-0 h-2 w-full text-signal-500/70"
              >
                <path
                  d="M2 10 Q125 2 250 8 T498 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>

          <p className="mt-6 max-w-prose-wide text-lg leading-relaxed text-neutral-400 md:text-xl">
            {t.sub}
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/pilot"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-base ease-out hover:bg-signal-400 hover:shadow-signal-glow focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background active:scale-[0.98]"
            >
              {t.ctaPilot}
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/#brief"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border px-6 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background"
            >
              <ArrowUp className="h-4 w-4 rotate-45" aria-hidden="true" />
              {t.ctaDemo}
            </Link>
          </div>

          <p className="mt-10 flex flex-wrap items-center gap-2 font-mono text-meta uppercase tracking-widest text-neutral-500">
            <MapPin className="h-3 w-3 text-signal-500" aria-hidden="true" />
            <span>{t.trustline}</span>
          </p>
        </div>

        {/* RIGHT — live chat inset (Live Fabric) */}
        <div className="relative flex items-center">
          <div
            className="relative w-full overflow-hidden rounded-[28px] border border-border/60 bg-background/92 shadow-[0_28px_80px_oklch(0.16_0.025_260/0.45)] ring-1 ring-border/40 backdrop-blur-2xl"
            style={{ minHeight: '520px' }}
            role="region"
            aria-label={`${chat.assistant} · ${chat.role}`}
          >
            {/* Header strip — gold gradient with brand mark */}
            <div
              className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-primary-foreground"
              style={{
                background:
                  'linear-gradient(135deg, oklch(0.78 0.17 78) 0%, oklch(0.58 0.12 65) 100%)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur-sm">
                  <BorjieMark size={20} />
                </span>
                <span className="font-display text-base font-semibold leading-tight tracking-tight">
                  {chat.assistant}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {chat.languageLabel}
                </span>
                <span className="h-3 w-px bg-white/20" aria-hidden="true" />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  <span
                    aria-hidden="true"
                    className="h-1 w-1 rounded-full bg-emerald-300"
                    style={
                      reducedMotion
                        ? undefined
                        : { animation: 'cursor-blink 1.5s steps(1) infinite' }
                    }
                  />
                  {chat.live}
                </span>
              </div>
            </div>

            {/* Body — choreographed turns */}
            <div className="space-y-3 px-4 py-4" style={{ minHeight: '300px' }}>
              {turns.map((turn, i) => (
                <ChatTurn
                  key={`${turn.role}-${i}`}
                  role={turn.role}
                  body={turn.body}
                  timestamp={turn.timestamp}
                  show={shown[i] ?? false}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>

            {/* AI compliance disclaimer (sits above the composer) */}
            <div
              className="absolute inset-x-0 flex items-center justify-center gap-2 bg-surface/60 px-4 py-2 text-center backdrop-blur-sm"
              style={{ bottom: '88px' }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, oklch(0.78 0.17 78 / 0.4), transparent)',
                }}
              />
              <ShieldCheck
                size={12}
                className="shrink-0 text-signal-500"
                aria-hidden="true"
              />
              <p className="text-[10px] leading-snug tracking-tight text-neutral-400">
                {chat.disclaimer}
              </p>
            </div>

            {/* Waveform watermark just above the composer */}
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center pb-1 opacity-40"
              style={{ bottom: '92px' }}
            >
              <MiniWaveform reducedMotion={reducedMotion} />
            </div>

            {/* Composer */}
            <div className="absolute inset-x-0 bottom-0 border-t border-border/60 bg-background/95 px-4 pb-3 pt-3 backdrop-blur-md">
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  aria-label={chat.voice}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-neutral-400 transition-colors hover:bg-surface text-foreground/80 focus:outline-none focus:ring-2 focus:ring-signal-500"
                >
                  <Mic className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={chat.attach}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-neutral-400 transition-colors hover:bg-surface text-foreground/80 focus:outline-none focus:ring-2 focus:ring-signal-500"
                >
                  <Camera className="h-4 w-4" />
                </button>
                <Link
                  href="/pilot"
                  className="group flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm text-neutral-400 transition-colors hover:border-signal-500 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
                >
                  <span className="flex-1">{chat.ask}</span>
                </Link>
                <Link
                  href="/pilot"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary-foreground transition-all hover:scale-[1.04] active:scale-[0.96] focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background"
                  style={{
                    background:
                      'linear-gradient(135deg, oklch(0.86 0.16 80) 0%, oklch(0.78 0.17 78) 50%, oklch(0.58 0.12 65) 100%)',
                    boxShadow:
                      '0 8px 20px -4px oklch(0.58 0.12 65 / 0.45), 0 2px 6px oklch(0.32 0.08 60 / 0.25)',
                  }}
                  aria-label={chat.send}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </Link>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-neutral-500">
                  {chat.languageHint}{' '}
                  <span className="font-medium text-signal-500">
                    {chat.language}
                  </span>
                </span>
                <span className="text-[10px] text-neutral-500">
                  {chat.micReady}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
