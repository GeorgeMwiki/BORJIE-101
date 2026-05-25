import * as React from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastProps,
} from './Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = 'default' | 'destructive' | 'success' | 'warning' | 'info';

export interface ToastOptions {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
  open: boolean;
}

// ---------------------------------------------------------------------------
// Store (event emitter — mirrors the popular shadcn/ui pattern but immutable)
// ---------------------------------------------------------------------------

type Listener = (toasts: ReadonlyArray<ToastRecord>) => void;

const LIMIT = 3;
const DEFAULT_DURATION = 5000;

let counter = 0;
function nextId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `toast-${Date.now()}-${counter}`;
}

const store = {
  toasts: [] as ReadonlyArray<ToastRecord>,
  listeners: new Set<Listener>(),
};

function emit(next: ReadonlyArray<ToastRecord>): void {
  store.toasts = next;
  store.listeners.forEach((listener) => listener(next));
}

function subscribe(listener: Listener): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function pushToast(options: ToastOptions): string {
  const id = options.id ?? nextId();
  const record: ToastRecord = {
    ...options,
    id,
    open: true,
  };
  // Immutable update — cap at LIMIT, newest first.
  const next = [record, ...store.toasts.filter((t) => t.id !== id)].slice(0, LIMIT);
  emit(next);
  return id;
}

function dismissToast(id?: string): void {
  const next = store.toasts.map((t) =>
    !id || t.id === id ? { ...t, open: false } : t
  );
  emit(next);
}

function removeToast(id: string): void {
  emit(store.toasts.filter((t) => t.id !== id));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseToastReturn {
  toasts: ReadonlyArray<ToastRecord>;
  toast: (options: ToastOptions) => string;
  dismiss: (id?: string) => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = React.useState<ReadonlyArray<ToastRecord>>(store.toasts);

  React.useEffect(() => subscribe(setToasts), []);

  return {
    toasts,
    toast: pushToast,
    dismiss: dismissToast,
  };
}

// Imperative helper — usable outside React (e.g. from mutation callbacks).
export const toast = (options: ToastOptions): string => pushToast(options);
toast.success = (title: React.ReactNode, description?: React.ReactNode): string =>
  pushToast({ title, description, variant: 'success' });
toast.error = (title: React.ReactNode, description?: React.ReactNode): string =>
  pushToast({ title, description, variant: 'destructive' });
toast.warning = (title: React.ReactNode, description?: React.ReactNode): string =>
  pushToast({ title, description, variant: 'warning' });
toast.info = (title: React.ReactNode, description?: React.ReactNode): string =>
  pushToast({ title, description, variant: 'info' });
toast.dismiss = dismissToast;

// ---------------------------------------------------------------------------
// <Toaster /> — mount once near the root of each app.
// ---------------------------------------------------------------------------

export function Toaster(): JSX.Element {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, variant, duration, open, ...rest }) => {
        // `variant` flows into the `Toast` class variants.
        const toastProps: ToastProps & { variant?: ToastVariant } = {
          variant,
          duration: duration ?? DEFAULT_DURATION,
          open,
          onOpenChange: (next) => {
            if (!next) {
              dismiss(id);
              // Schedule removal so exit animation plays.
              setTimeout(() => removeToast(id), 300);
            }
          },
          ...rest,
        };
        return (
          <Toast key={id} {...toastProps}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <ToastClose aria-label="Close notification" />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
