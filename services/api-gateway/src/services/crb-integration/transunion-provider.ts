/**
 * TransUnion TZ provider.
 *
 * Wraps the TransUnion CreditView REST API. Activation via env vars
 * `CRB_TRANSUNION_BASE_URL`, `CRB_TRANSUNION_API_KEY`,
 * `CRB_TRANSUNION_SUBSCRIBER_CODE`.
 *
 * Soft-fails to a `degraded:true` empty report so the side-quest does
 * not block on transport errors.
 */

import type {
  CrbProvider,
  CrbReport,
  CrbReportRequest,
} from './types.js';

interface TuConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly subscriberCode: string;
}

function envConfig(env: NodeJS.ProcessEnv): TuConfig | null {
  const baseUrl = env.CRB_TRANSUNION_BASE_URL?.trim();
  const apiKey = env.CRB_TRANSUNION_API_KEY?.trim();
  const subscriberCode = env.CRB_TRANSUNION_SUBSCRIBER_CODE?.trim();
  if (!baseUrl || !apiKey || !subscriberCode) return null;
  return { baseUrl, apiKey, subscriberCode };
}

function bandFor(score: number): CrbReport['scoreBand'] {
  if (score >= 800) return 'excellent';
  if (score >= 700) return 'good';
  if (score >= 600) return 'fair';
  if (score >= 450) return 'poor';
  return 'unrated';
}

function degradedReport(req: CrbReportRequest): CrbReport {
  return {
    provider: 'transunion',
    subject: {
      tin: req.tin,
      nida: req.nida,
      displayName: req.displayName ?? null,
    },
    score: 0,
    scoreBand: 'unrated',
    openCredits: [],
    defaults: [],
    history: [],
    pulledAt: new Date().toISOString(),
    cacheable: false,
    degraded: true,
  };
}

export function createTransUnionCrbProvider(
  env: NodeJS.ProcessEnv = process.env,
): CrbProvider {
  const cfg = envConfig(env);
  return {
    name: 'transunion',
    async fetchReport(req: CrbReportRequest): Promise<CrbReport> {
      if (!cfg) return degradedReport(req);
      try {
        const res = await fetch(`${cfg.baseUrl}/creditview/v2/score`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': cfg.apiKey,
            'X-Subscriber-Code': cfg.subscriberCode,
          },
          body: JSON.stringify({
            tin: req.tin,
            nida: req.nida,
          }),
        });
        if (!res.ok) return degradedReport(req);
        const body = (await res.json()) as Record<string, unknown>;
        const rawScore = Number(body.score) || 0;
        // TransUnion normalises 0-1000; we squash to the standard CRSA
        // 300-900 band so consumers don't need provider-specific UI.
        const score = Math.max(300, Math.min(900, Math.round((rawScore / 1000) * 600 + 300)));
        return {
          provider: 'transunion',
          subject: {
            tin: req.tin,
            nida: req.nida,
            displayName: req.displayName ?? null,
          },
          score,
          scoreBand: bandFor(score),
          openCredits: Array.isArray(body.tradelines)
            ? (body.tradelines as CrbReport['openCredits'])
            : [],
          defaults: Array.isArray(body.publicRecords)
            ? (body.publicRecords as CrbReport['defaults'])
            : [],
          history: Array.isArray(body.scoreHistory)
            ? (body.scoreHistory as CrbReport['history'])
            : [],
          pulledAt: new Date().toISOString(),
          cacheable: true,
          degraded: false,
        };
      } catch {
        return degradedReport(req);
      }
    },
  };
}
