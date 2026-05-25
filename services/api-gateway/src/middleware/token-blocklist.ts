/**
 * Token revocation blocklist.
 *
 * JWTs are stateless, so `/auth/logout` and refresh-token rotation
 * cannot actually invalidate a token without out-of-band state. This
 * module provides a process-local blocklist keyed by JWT `jti` claim.
 * When a token is invalidated (logout, refresh rotation, role change)
 * its jti is added here with an expiry that matches the token's own
 * `exp` claim — no point retaining it after natural expiry.
 *
 * For multi-replica deployments this should be swapped for a
 * Redis-backed blocklist (single-hop lookup, shared across replicas).
 * The interface below is deliberately tiny so the swap is one file.
 */

interface BlocklistEntry {
  expiresAt: number; // epoch ms
}

class InProcessTokenBlocklist {
  private readonly entries = new Map<string, BlocklistEntry>();

  constructor() {
    // Reap expired entries hourly to keep memory bounded.
    setInterval(() => this.reap(), 60 * 60 * 1000).unref?.();
  }

  /** Revoke a token by its jti; TTL comes from the token's own exp. */
  revoke(jti: string, exp: number): void {
    // `exp` is in seconds per the JWT spec.
    this.entries.set(jti, { expiresAt: exp * 1000 });
  }

  /** Returns true if the jti has been revoked AND hasn't expired yet. */
  isRevoked(jti: string): boolean {
    const entry = this.entries.get(jti);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(jti);
      return false;
    }
    return true;
  }

  /** Exposed for tests; do not call from production. */
  clear(): void {
    this.entries.clear();
  }

  private reap(): void {
    const now = Date.now();
    for (const [jti, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(jti);
    }
  }
}

export const tokenBlocklist = new InProcessTokenBlocklist();
