// JWT Service
export {
  JwtService,
  jwtService,
  type TokenPayload,
  type TokenPair,
  type JwtConfig,
} from './jwt.service.js';

// RBAC Engine
export {
  RbacEngine,
  rbacEngine,
  type Action,
  type Resource,
  type Permission,
  type Role,
  type User,
  type RbacConfig,
} from './rbac.engine.js';

// ABAC Engine
export {
  AbacEngine,
  abacEngine,
  type Operator,
  type Condition,
  type Rule,
  type Policy,
  type EvaluationContext,
  type EvaluationResult,
} from './abac.engine.js';

// System Roles & Role Identity Helpers (Piece P)
export {
  SystemRoles,
  isAdminRole,
  type SystemRole,
} from './system-roles.js';
