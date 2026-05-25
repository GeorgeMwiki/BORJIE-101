import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { UserRole } from '../types/user-role';
import { getJwtSecret } from '../config/jwt';
import { tokenBlocklist } from './token-blocklist';

// Simplified AuthContext for the API gateway
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
}

const JWT_SECRET = getJwtSecret();

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

export interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  /** JWT ID — used for revocation via tokenBlocklist. */
  jti?: string;
  exp: number;
  iat: number;
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid authorization header',
        },
      });
    }

    const token = authHeader.split(' ')[1];

    try {
      // Pin the algorithm explicitly. Without this, jsonwebtoken accepts
      // any algorithm supported by the key — the classic "alg=none" and
      // RS256-vs-HS256 confusion attacks both become possible. HS256 is
      // the only algorithm we sign with (generateToken below).
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JWTPayload;

      // Check revocation blocklist (logout + refresh-rotation flow).
      if (decoded.jti && tokenBlocklist.isRevoked(decoded.jti)) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Authentication token has been revoked',
          },
        });
      }

      (req as AuthenticatedRequest).auth = {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        role: decoded.role,
        permissions: decoded.permissions,
        propertyAccess: decoded.propertyAccess,
      };

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Authentication token has expired',
          },
        });
      }

      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid authentication token',
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

export const requireRole = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;

    if (!auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!roles.includes(auth.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
    }

    next();
  };
};

export const requirePermission = (...permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthenticatedRequest).auth;

    if (!auth) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const hasPermission = permissions.every(
      (p) => auth.permissions.includes(p) || auth.role === UserRole.SUPER_ADMIN
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
    }

    next();
  };
};

export const generateToken = (payload: Omit<JWTPayload, 'exp' | 'iat' | 'jti'>): string => {
  // 1-hour access token TTL. Use /auth/refresh to extend sessions. This limits
  // blast radius on token theft — a stolen token is useful for at most an hour.
  //
  // Inject a fresh jti per token so /auth/logout and /auth/refresh can
  // revoke the specific issued token via the blocklist. Two tabs that
  // each mint a token get distinct jtis — revocation is scoped to the
  // one that requested it, not the whole user.
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '1h',
    jwtid: randomUUID(),
    algorithm: 'HS256',
  });
};
