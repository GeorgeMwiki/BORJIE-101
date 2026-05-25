import jwt, { JwtPayload, SignOptions, VerifyOptions } from 'jsonwebtoken';

export interface TokenPayload {
  sub: string;
  email?: string;
  roles: string[];
  permissions?: string[];
  tenantId?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface JwtConfig {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiresIn: string | number;
  refreshTokenExpiresIn: string | number;
  issuer?: string;
  audience?: string;
}

export class JwtService {
  private readonly config: JwtConfig;

  constructor(config: Partial<JwtConfig> = {}) {
    const accessSecret = config.accessTokenSecret || process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
    const refreshSecret = config.refreshTokenSecret || process.env.JWT_REFRESH_SECRET;
    // Hard fail in any non-test environment when secrets are missing.
    // The old code silently fell back to `access-secret-change-me`, which
    // is a well-known string — anyone who reads the repo could forge
    // tokens signed with it. Test runs stay on randomised per-process
    // secrets so the test suite doesn't require env wiring.
    const env = process.env.NODE_ENV;
    if (env !== 'test' && (!accessSecret || !refreshSecret)) {
      throw new Error(
        'JwtService: JWT_ACCESS_SECRET (or JWT_SECRET) and JWT_REFRESH_SECRET are required. ' +
          'Hardcoded fallbacks have been removed to prevent token forgery.'
      );
    }
    // Per-process random fallback for tests — rotated every process start
    // so a leaked test secret can't be reused across CI runs.
    const testFallbackAccess =
      accessSecret ?? `test-access-${Math.random().toString(36).slice(2)}`;
    const testFallbackRefresh =
      refreshSecret ?? `test-refresh-${Math.random().toString(36).slice(2)}`;
    // A short secret is almost as bad as a known one — reject <32 chars in prod.
    if (env === 'production') {
      if ((accessSecret ?? '').length < 32) {
        throw new Error('JwtService: JWT access secret must be at least 32 characters in production');
      }
      if ((refreshSecret ?? '').length < 32) {
        throw new Error('JwtService: JWT refresh secret must be at least 32 characters in production');
      }
    }
    this.config = {
      accessTokenSecret: testFallbackAccess,
      refreshTokenSecret: testFallbackRefresh,
      accessTokenExpiresIn: config.accessTokenExpiresIn || '15m',
      refreshTokenExpiresIn: config.refreshTokenExpiresIn || '7d',
      issuer: config.issuer || 'borjie',
      audience: config.audience || 'borjie-api',
    };
  }

  /**
   * Sign an access token
   */
  signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
    const options: SignOptions = {
      expiresIn: this.config.accessTokenExpiresIn as SignOptions['expiresIn'],
      issuer: this.config.issuer,
      audience: this.config.audience,
      subject: payload.sub,
    };

    return jwt.sign(
      {
        email: payload.email,
        roles: payload.roles,
        permissions: payload.permissions,
        tenantId: payload.tenantId,
      },
      this.config.accessTokenSecret,
      options
    );
  }

  /**
   * Sign a refresh token
   */
  signRefreshToken(payload: Pick<TokenPayload, 'sub'>): string {
    const options: SignOptions = {
      expiresIn: this.config.refreshTokenExpiresIn as SignOptions['expiresIn'],
      issuer: this.config.issuer,
      audience: this.config.audience,
      subject: payload.sub,
    };

    return jwt.sign({}, this.config.refreshTokenSecret, options);
  }

  /**
   * Generate both access and refresh tokens
   */
  generateTokenPair(payload: Omit<TokenPayload, 'iat' | 'exp'>): TokenPair {
    const accessToken = this.signAccessToken(payload);
    const refreshToken = this.signRefreshToken({ sub: payload.sub });

    const accessDecoded = jwt.decode(accessToken) as JwtPayload;
    const refreshDecoded = jwt.decode(refreshToken) as JwtPayload;

    return {
      accessToken,
      refreshToken,
      expiresIn: accessDecoded.exp! - Math.floor(Date.now() / 1000),
      refreshExpiresIn: refreshDecoded.exp! - Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Verify an access token
   */
  verifyAccessToken(token: string): TokenPayload {
    const options: VerifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
    };

    const decoded = jwt.verify(token, this.config.accessTokenSecret, options) as JwtPayload;

    return {
      sub: decoded.sub!,
      email: decoded.email,
      roles: decoded.roles || [],
      permissions: decoded.permissions,
      tenantId: decoded.tenantId,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  }

  /**
   * Verify a refresh token
   */
  verifyRefreshToken(token: string): { sub: string; iat?: number; exp?: number } {
    const options: VerifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
    };

    const decoded = jwt.verify(token, this.config.refreshTokenSecret, options) as JwtPayload;

    return {
      sub: decoded.sub!,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  }

  /**
   * Refresh tokens - verify refresh token and generate new pair
   */
  async refreshTokens(
    refreshToken: string,
    getUserPayload: (userId: string) => Promise<Omit<TokenPayload, 'iat' | 'exp'>>
  ): Promise<TokenPair> {
    const { sub } = this.verifyRefreshToken(refreshToken);
    const userPayload = await getUserPayload(sub);
    return this.generateTokenPair(userPayload);
  }

  /**
   * Decode token without verification (for debugging)
   */
  decodeToken(token: string): JwtPayload | null {
    return jwt.decode(token) as JwtPayload | null;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token: string): boolean {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.exp) return true;
    return decoded.exp < Math.floor(Date.now() / 1000);
  }

  /**
   * Get time until token expires (in seconds)
   */
  getTokenTTL(token: string): number {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.exp) return 0;
    return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
  }
}

export const jwtService = new JwtService();
