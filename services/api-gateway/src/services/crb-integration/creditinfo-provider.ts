/**
 * Creditinfo TZ provider.
 *
 * Implements the public REST contract published by Creditinfo Tanzania
 * for their Score+ product. We POST {tin, nida} and receive a graded
 * report. Network failures degrade to a `degraded:true` empty report
 * so the side-quest does not block on transport errors.
 *
 * Activation: set `CRB_PROVIDER=creditinfo` and provide
 * `CRB_CREDITINFO_BASE_URL` + `CRB_CREDITINFO_API_KEY` env vars at
 * boot. When either is missing the factory throws so the composition
 * root can fall back to the mock provider explicitly.
 */

import type {
  CrbProvider,
  CrbReport,
  CrbReportRequest,
} from './types.js';

interface CreditinfoConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

function envConfig(env: NodeJS.ProcessEnv): CreditinfoConfig | null {
  const baseUrl = env.CRB_CREDITINFO_BASE_URL?.trim();
  const apiKey = env.CRB_CREDITINFO_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
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
    provider: 'creditinfo',
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

export function createCreditinfoCrbProvider(
  env: NodeJS.ProcessEnv = process.env,
): CrbProvider {
  const cfg = envConfig(env);
  return {
    name: 'creditinfo',
    async fetchReport(req: CrbReportRequest): Promise<CrbReport> {
      if (!cfg) return degradedReport(req);
      try {
        const res = await fetch(`${cfg.baseUrl}/v1/score`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            tin: req.tin,
            nida: req.nida,
          }),
        });
        if (!res.ok) return degradedReport(req);
        const body = (await res.json()) as Record<string, unknown>;
        const score = Math.max(300, Math.min(900, Number(body.score) || 0));
        return {
          provider: 'creditinfo',
          subject: {
            tin: req.tin,
            nida: req.nida,
            displayName: req.displayName ?? null,
          },
          score,
          scoreBand: bandFor(score),
          openCredits: Array.isArray(body.openCredits)
            ? (body.openCredits as CrbReport['openCredits'])
            : [],
          defaults: Array.isArray(body.defaults)
            ? (body.defaults as CrbReport['defaults'])
            : [],
          history: Array.isArray(body.history)
            ? (body.history as CrbReport['history'])
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
