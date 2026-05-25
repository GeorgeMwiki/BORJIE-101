/**
 * `arrears.escalate_to_call` — external-comm tier.
 *
 * Places an outbound voice call to the tenant via the configured
 * telephony port (production wires Twilio / Africa's Talking; tests
 * inject a fake). external-comm tier → kernel applies four-eye review
 * before the action runs, OR the owner has pre-approved the standing
 * call-out policy.
 *
 * The function itself just constructs the dial draft and asks the
 * transport to place it; gating is the MD's job upstream.
 */

export interface CallScript {
  readonly tenantId: string;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly amountMinor: number;
  readonly currency: string;
  readonly maxDurationSeconds: number;
  readonly script: string;
}

export interface CallTransport {
  placeCall(args: { readonly script: CallScript }): Promise<{ readonly callSid: string }>;
}

export interface EscalateToCallArgs {
  readonly script: CallScript;
  readonly transport: CallTransport;
  readonly correlationId: string;
  readonly ownerHasPreApprovedCalls: boolean;
}

export interface EscalateToCallResult {
  readonly status: 'placed' | 'queued-for-four-eye';
  readonly callSid?: string;
  readonly reason?: string;
}

export async function escalateToCall(args: EscalateToCallArgs): Promise<EscalateToCallResult> {
  if (!args.ownerHasPreApprovedCalls) {
    return Object.freeze({
      status: 'queued-for-four-eye',
      reason: 'outbound voice calls are external-comm tier; require four-eye approval',
    });
  }
  const result = await args.transport.placeCall({ script: args.script });
  return Object.freeze({
    status: 'placed',
    callSid: result.callSid,
  });
}

/**
 * Render a default short call script — used when the MD does not
 * supply one. Bilingual.
 */
export function renderCallScript(args: {
  readonly tenantName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly daysOverdue: number;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly tenantId: string;
}): CallScript {
  const major = (args.amountMinor / 100).toFixed(0);
  let script: string;
  if (args.language === 'sw') {
    script = `Habari ${args.tenantName}. Hii ni simu kutoka kwa wakala wako wa mali. Tunatambua kuwa kuna deni la ${args.currency} ${major} ambalo limechelewa kwa siku ${args.daysOverdue}. Tunapenda kuelewa hali yako na kupanga njia ya kulipa. Tafadhali wasiliana nasi.`;
  } else {
    script = `Hello ${args.tenantName}, this is a courtesy call from your property manager regarding an outstanding balance of ${args.currency} ${major} which is ${args.daysOverdue} days overdue. We would like to understand your situation and agree on a payment plan. Please call us back.`;
  }
  return Object.freeze({
    tenantId: args.tenantId,
    language: args.language,
    amountMinor: args.amountMinor,
    currency: args.currency,
    maxDurationSeconds: 90,
    script,
  });
}
