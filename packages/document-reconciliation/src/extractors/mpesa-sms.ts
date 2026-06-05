/**
 * M-PESA SMS extractor (LP-26).
 *
 * Tanzania M-PESA confirmation messages have a stable line-oriented shape:
 * a reference id, an amount with currency, an optional counterpart, a
 * date/time, and a resulting balance. A regex grammar handles the canonical
 * EN + SW surface forms; an optional injected LLM fallback normalises
 * truncated / reformatted forwards. Pure (the fallback is a port).
 *
 * Mining context: miners receive M-PESA payouts and pay royalty/levies via
 * M-PESA; these records feed the cross-document reconciler (amount + phone).
 *
 * Test fixtures NEVER reference real merchant names.
 *
 * @module @borjie/document-reconciliation/extractors/mpesa-sms
 */

export interface MpesaSmsRecord {
  readonly referenceId: string;
  /** Amount with no currency symbol. */
  readonly amount: number;
  readonly direction: 'sent' | 'received' | 'withdrawn' | 'deposit' | 'unknown';
  readonly counterpart?: string;
  readonly balance?: number;
  /** ISO 8601 when parseable. */
  readonly occurredAt?: string;
  readonly rawText: string;
}

export interface MpesaSmsBatchResult {
  readonly records: readonly MpesaSmsRecord[];
  readonly unparsedLines: readonly string[];
}

/** Optional LLM normaliser used when the regex grammar fails. */
export interface MpesaSmsLlmFallback {
  normalise(rawText: string): Promise<MpesaSmsRecord | null>;
}

/**
 * Parse a batch of pasted M-PESA SMS texts (split on blank lines so multiple
 * messages can be pasted together). Never throws — unparseable lines are
 * collected separately.
 */
export async function extractMpesaSms(
  input: string,
  fallback?: MpesaSmsLlmFallback,
): Promise<MpesaSmsBatchResult> {
  const lines = input
    .split(/\r?\n\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const records: MpesaSmsRecord[] = [];
  const unparsed: string[] = [];

  for (const line of lines) {
    const direct = parseOneMessage(line);
    if (direct) {
      records.push(direct);
      continue;
    }
    if (fallback) {
      try {
        const normalised = await fallback.normalise(line);
        if (normalised) {
          records.push(normalised);
          continue;
        }
      } catch {
        // fall through
      }
    }
    unparsed.push(line);
  }

  return { records: Object.freeze(records), unparsedLines: Object.freeze(unparsed) };
}

export function parseOneMessage(text: string): MpesaSmsRecord | null {
  const cleaned = text.replace(/\s+/g, ' ').trim();

  const refMatch = /\b([A-Z0-9]{8,12})(?=\b|\.| )/.exec(cleaned);
  if (!refMatch) return null;
  const referenceId = refMatch[1] ?? '';

  const amountMatch = /(?:Tsh|TZS)\.?\s*([\d,]+(?:\.\d{2})?)/i.exec(cleaned);
  if (!amountMatch) return null;
  const amount = Number((amountMatch[1] ?? '').replace(/[,\s]/g, ''));
  if (!Number.isFinite(amount)) return null;

  const balanceMatch =
    /(?:New\s*M-?PESA\s*balance\s*is|Salio\s*(?:jipya\s*)?(?:ya|la)\s*M-?PESA\s*ni)\s*(?:Tsh|TZS)\.?\s*([\d,]+(?:\.\d{2})?)/i.exec(
      cleaned,
    );
  const balance = balanceMatch ? Number((balanceMatch[1] ?? '').replace(/[,\s]/g, '')) : undefined;

  const counterpartMatch =
    /(?:to|from|kwa|kutoka)\s+([A-Z][A-Za-z .'-]{2,40}?)(?=\s+(?:on|tarehe|at|saa|\.|,)|$)/i.exec(cleaned);
  const counterpart = counterpartMatch?.[1]?.trim();

  let direction: MpesaSmsRecord['direction'] = 'unknown';
  if (/(you have sent|umetuma)/i.test(cleaned)) direction = 'sent';
  else if (/(you have received|umepokea)/i.test(cleaned)) direction = 'received';
  else if (/(withdraw|umetoa)/i.test(cleaned)) direction = 'withdrawn';
  else if (/(deposit|umeweka)/i.test(cleaned)) direction = 'deposit';

  const dateMatch =
    /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?))?/i.exec(cleaned);
  const occurredAt = dateMatch ? buildIso(dateMatch[1] ?? '', dateMatch[2]) : undefined;

  return {
    referenceId,
    amount,
    direction,
    ...(counterpart ? { counterpart } : {}),
    ...(balance !== undefined ? { balance } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    rawText: text,
  };
}

function buildIso(datePart: string, timePart?: string): string | undefined {
  const parts = datePart.split(/[/-]/).map((p) => p.trim());
  if (parts.length !== 3) return undefined;
  let d = parts[0] ?? '';
  let m = parts[1] ?? '';
  let y = parts[2] ?? '';
  if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
  if (d.length === 4) {
    // The input was Y-M-D, not D-M-Y.
    y = parts[0] ?? '';
    m = parts[1] ?? '';
    d = parts[2] ?? '';
  }
  const pad = (s: string) => s.padStart(2, '0');
  const timeStr = timePart ? formatTime(timePart) : '00:00:00';
  return `${y}-${pad(m)}-${pad(d)}T${timeStr}`;
}

function formatTime(t: string): string {
  const ampm = /\b(AM|PM)\b/i.exec(t);
  const numbers = t.replace(/[^\d:]/g, '').split(':');
  let h = Number(numbers[0] ?? '0');
  const min = numbers[1] ?? '00';
  const sec = numbers[2] ?? '00';
  if (ampm) {
    if (/PM/i.test(ampm[1] ?? '') && h < 12) h += 12;
    if (/AM/i.test(ampm[1] ?? '') && h === 12) h = 0;
  }
  return `${String(h).padStart(2, '0')}:${min.padStart(2, '0')}:${sec.padStart(2, '0')}`;
}
