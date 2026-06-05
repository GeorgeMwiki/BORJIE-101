'use client';

/**
 * Create-course gateway client (gap 11).
 *
 * A self-contained typed fetch layer for /api/v1/courses/* — the same house
 * convention as the training-gateway (a local fetch that forwards the Supabase
 * bearer + session cookie and surfaces the gateway's `{ success, data }`
 * envelope). owner-web fetches NATIVELY here; no api-client VALUE is imported.
 *
 * PITFALL 1 (NodeNext barrel) — every TYPE comes from the
 * `@borjie/api-client/courses-types` tsconfig path alias (→ the pure-type
 * source), never the package barrel, so a strict consumer resolves the type
 * shapes without dragging api-client/client.ts into the typecheck.
 *
 * HONEST-DEGRADE: a non-2xx surfaces as a typed `CourseGatewayError` whose
 * `.status` lets the caller branch (503 → service unavailable). Content is
 * NEVER fabricated — a failed generation surfaces the gateway's
 * `generationError` on the polled course; the FE shows a retry affordance.
 */

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { API_BASE } from '@/lib/api-client';
import type {
  CourseSummary,
  CourseWithLessons,
  GenerateCourseRequest,
  GenerateCourseAccepted,
} from '@borjie/api-client/courses-types';

export type {
  CourseLanguage,
  CourseDifficulty,
  CourseStatus,
  CourseLessonStatus,
  CourseGenerationSource,
  CourseQuizQuestion,
  CourseLessonContent,
  CourseLessonRow,
  CourseSummary,
  CourseWithLessons,
  CourseDocumentInput,
  GenerateCourseRequest,
  GenerateCourseAccepted,
} from '@borjie/api-client/courses-types';

const REQUEST_TIMEOUT_MS = 20_000;

/** Typed gateway failure carrying the HTTP status so callers can branch. */
export class CourseGatewayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CourseGatewayError';
    this.status = status;
  }
}

/** The gateway's success envelope. */
interface Envelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function bearerHeader(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const auth = await bearerHeader();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...auth,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit = {
    method,
    credentials: 'include',
    signal: controller.signal,
    headers,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : 'network unreachable';
    throw new CourseGatewayError(message, 0);
  }
  clearTimeout(timer);

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json || json.success === false) {
    const message = json?.error?.message ?? `request failed with HTTP ${res.status}`;
    throw new CourseGatewayError(message, res.status);
  }
  return json.data;
}

/** Kick off generation. Returns the placeholder id (202); poll `getCourse`. */
export async function generateCourse(
  body: GenerateCourseRequest,
): Promise<GenerateCourseAccepted> {
  return call<GenerateCourseAccepted>('POST', '/courses/generate', body);
}

/** List my generated courses, newest first. */
export async function listCourses(): Promise<readonly CourseSummary[]> {
  return call<readonly CourseSummary[]>('GET', '/courses');
}

/** Load one of my courses with its lessons (the poller hits this). */
export async function getCourse(courseId: string): Promise<CourseWithLessons> {
  return call<CourseWithLessons>(
    'GET',
    `/courses/${encodeURIComponent(courseId)}`,
  );
}
