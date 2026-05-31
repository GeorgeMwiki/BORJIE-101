/**
 * SSRF guard for OCR adapter endpoints.
 *
 * OCR adapters POST raw document bytes to a configured `endpoint`. If that
 * endpoint is ever pointed (via misconfiguration or config injection) at a
 * cloud-metadata service, an attacker can exfiltrate instance credentials —
 * the document bytes are the request body, but the *destination* is the
 * danger. This guard blocks the unambiguous SSRF targets (cloud-metadata +
 * link-local ranges) while deliberately allowing general internal hosts, so
 * legitimately in-cluster OCR services (docling/marker) keep working.
 */

const BLOCKED_METADATA_HOSTS: ReadonlySet<string> = new Set([
  '169.254.169.254', // AWS / Azure IMDS
  '169.254.170.2', // AWS ECS task metadata
  '100.100.100.200', // Alibaba Cloud
  'metadata.google.internal', // GCP
  'metadata', // GCP short name
  'fd00:ec2::254', // AWS IMDSv2 IPv6
]);

/**
 * Throws when the OCR endpoint is not a valid http(s) URL or targets a
 * cloud-metadata / link-local host. Safe for in-cluster + localhost dev
 * endpoints (only metadata + 169.254.0.0/16 + fe80::/10 are rejected).
 */
export function assertSafeOcrEndpoint(endpoint: string): void {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new Error(`OCR endpoint is not a valid URL: ${endpoint}`);
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new Error(`OCR endpoint must use http(s): ${endpoint}`);
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_METADATA_HOSTS.has(host)) {
    throw new Error(`OCR endpoint targets a blocked metadata host: ${host}`);
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m && Number(m[1]) === 169 && Number(m[2]) === 254) {
    throw new Error(`OCR endpoint targets the link-local/metadata range: ${host}`);
  }
  if (host.startsWith('fe80')) {
    throw new Error(`OCR endpoint targets a link-local IPv6 host: ${host}`);
  }
}
