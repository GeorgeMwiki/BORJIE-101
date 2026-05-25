/**
 * @Audited Decorator
 * Automatically logs audit entries for decorated service methods.
 * Captures before/after values for updates, IP and user agent from context.
 */

import type { AuditAction, AuditChange } from './types.js';
import { getAuditContext } from './audit-context.js';

export interface AuditedOptions {
  /** Action to log (default: inferred from method name) */
  action?: AuditAction;
  /** Entity type (e.g. 'User', 'Property') */
  entityType: string;
  /** Function to extract entity ID from method args */
  entityIdFromArgs?: (args: unknown[]) => string | null;
  /** Function to extract entity ID from method result */
  entityIdFromResult?: (result: unknown) => string | null;
  /** Function to extract before value for update (for change detection) */
  beforeFromArgs?: (args: unknown[]) => unknown;
  /** Function to extract after value from result */
  afterFromResult?: (result: unknown) => unknown;
  /** Fields to include in change detection (for updates) */
  changeFields?: readonly string[];
}

function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[]
): AuditChange[] {
  const changes: AuditChange[] = [];
  const beforeObj = before && typeof before === 'object' ? before : {};
  const afterObj = after && typeof after === 'object' ? after : {};
  const keys = fields ?? [
    ...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ];

  for (const field of keys) {
    const oldVal = beforeObj[field];
    const newVal = afterObj[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

function inferAction(methodName: string): AuditAction {
  const name = methodName.toLowerCase();
  if (name.includes('create') || name.includes('add')) return 'create';
  if (name.includes('update') || name.includes('edit') || name.includes('change')) return 'update';
  if (name.includes('delete') || name.includes('remove')) return 'delete';
  if (name.includes('approve')) return 'approve';
  if (name.includes('reject')) return 'reject';
  if (name.includes('export')) return 'export';
  if (name.includes('login')) return 'login';
  if (name.includes('logout')) return 'logout';
  return 'read';
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

/**
 * Decorator factory for audit logging.
 * Use with: @Audited({ entityType: 'User', entityIdFromArgs: (args) => args[0] })
 */
export function Audited(options: AuditedOptions) {
  return function (
    _target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    if (typeof original !== 'function') return descriptor;

    descriptor.value = async function (this: { auditService?: import('./audit-service.js').AuditService }, ...args: unknown[]) {
      const auditService = this.auditService;
      if (!auditService) {
        return original.apply(this, args);
      }

      const action = options.action ?? inferAction(propertyKey);
      const tenantId = (args[0] as string) ?? '';
      const entityId =
        options.entityIdFromArgs?.(args) ??
        options.entityIdFromResult?.(null) ??
        null;

      let before: unknown;
      if (action === 'update' && options.beforeFromArgs) {
        before = options.beforeFromArgs(args);
      }

      const result = await original.apply(this, args);

      let changes: AuditChange[] = [];
      if (action === 'update' && options.beforeFromArgs && options.afterFromResult) {
        const after = options.afterFromResult(result);
        changes = diffChanges(
          toRecord(before),
          toRecord(after),
          options.changeFields
        );
      }

      const resolvedEntityId = entityId ?? options.entityIdFromResult?.(result) ?? null;
      const ctx = getAuditContext();

      await auditService.logAudit(
        tenantId,
        action,
        options.entityType,
        resolvedEntityId,
        ctx.userId ?? undefined,
        changes.length > 0 ? changes : undefined,
        { method: propertyKey }
      );

      return result;
    };

    return descriptor;
  };
}
