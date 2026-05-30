"use client";

/**
 * 28. live-counter — real-time counter (queue depth, payment-rail latency).
 *
 * The brain emits the latest value + thresholds; the host portal can
 * keep re-rendering the same kind to animate the digit. We tween between
 * the prior render's value and the new one for a soft count effect.
 */

import { useEffect, useRef, useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { LiveCounterPartSchema } from "../schemas";
import { formatNumber } from "../format";

export type LiveCounterProps = AgUiUiPartByKind<"live-counter">;

function levelOf(props: LiveCounterProps): "ok" | "warn" | "critical" {
  if (
    typeof props.thresholdCritical === "number" &&
    props.value >= props.thresholdCritical
  ) {
    return "critical";
  }
  if (
    typeof props.thresholdWarn === "number" &&
    props.value >= props.thresholdWarn
  ) {
    return "warn";
  }
  return "ok";
}

export function LiveCounter(props: LiveCounterProps): JSX.Element {
  const parsed = LiveCounterPartSchema.safeParse(props);
  const prevRef = useRef<number>(props.value);
  const [shown, setShown] = useState<number>(props.value);

  useEffect(() => {
    const from = prevRef.current;
    const to = props.value;
    const steps = 12;
    const stepMs = 30;
    let i = 0;
    const id = setInterval(() => {
      i++;
      const t = i / steps;
      const next = from + (to - from) * t;
      setShown(next);
      if (i >= steps) {
        clearInterval(id);
        setShown(to);
        prevRef.current = to;
      }
    }, stepMs);
    return () => clearInterval(id);
  }, [props.value]);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="live-counter"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  const level = levelOf(props);
  const color =
    level === "critical"
      ? "text-destructive"
      : level === "warn"
        ? "text-amber-600"
        : "text-foreground";

  return (
    <Frame kind="live-counter" {...(props.title ? { title: props.title } : {})}>
      <div className="flex items-baseline justify-between gap-3">
        <div className={`text-3xl font-semibold tabular-nums ${color}`}>
          {formatNumber(Math.round(shown))}
          {props.unit ? (
            <span className="ml-1 text-sm text-muted-foreground">
              {props.unit}
            </span>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {props.label}
          </div>
          {props.trend ? (
            <div className="text-[11px] text-muted-foreground">
              trend:{" "}
              {props.trend === "up" ? "▲" : props.trend === "down" ? "▼" : "–"}
            </div>
          ) : null}
        </div>
      </div>
      {props.updatedAt ? (
        <div className="mt-1 text-[10px] text-muted-foreground">
          updated {new Date(props.updatedAt).toLocaleTimeString()}
        </div>
      ) : null}
    </Frame>
  );
}
