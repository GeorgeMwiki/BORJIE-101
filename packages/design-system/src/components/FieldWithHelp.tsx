/**
 * FieldWithHelp — form field wrapper with correct a11y wiring (LitFin bar).
 *
 * Wraps a single control with a label, optional help text, and an error
 * message, and — critically — wires the ARIA relationships that a bare
 * label+input pair omits:
 *   - `label htmlFor` ↔ control `id`
 *   - control `aria-describedby` ↔ help id AND error id (both when present)
 *   - control `aria-invalid` when an error is shown
 *   - control `aria-required` when required
 *
 * Because the control needs those generated ids, the field is passed as a
 * RENDER PROP receiving the resolved a11y props. Spread them onto your
 * input/select/textarea:
 *
 *   <FieldWithHelp
 *     label={t('licence.number.label')}
 *     help={t('licence.number.help')}
 *     error={errors.number}
 *     required
 *   >
 *     {(field) => <Input {...field} value={v} onChange={onChange} />}
 *   </FieldWithHelp>
 *
 * The error region is `role="alert"` so a newly-shown validation error is
 * announced. Copy (label / help / error / the required marker's a11y text)
 * is ALWAYS caller-supplied and localized — zero hardcoded strings.
 */
import * as React from 'react';
import { cn } from '../lib/utils';
import { Label } from './Label';

/** A11y props FieldWithHelp injects onto the wrapped control. */
export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly 'aria-required'?: boolean;
}

export interface FieldWithHelpProps {
  /** Localized field label. */
  readonly label: string;
  /**
   * Render prop receiving the wired a11y props. Spread onto the control:
   * `{(field) => <Input {...field} />}`.
   */
  readonly children: (field: FieldControlProps) => React.ReactNode;
  /** Optional localized help / hint text below the control. */
  readonly help?: string;
  /** Localized error message. When set, the field is marked invalid. */
  readonly error?: string;
  /** Explicit id; auto-generated when omitted. */
  readonly id?: string;
  /** Mark the field required (visual asterisk + aria-required). */
  readonly required?: boolean;
  /** Hide the label visually while keeping it for assistive tech. */
  readonly hideLabel?: boolean;
  readonly className?: string;
}

export const FieldWithHelp: React.FC<FieldWithHelpProps> = ({
  label,
  children,
  help,
  error,
  id,
  required = false,
  hideLabel = false,
  className,
}) => {
  const reactId = React.useId();
  const fieldId = id ?? `field-${reactId}`;
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;

  const hasError = Boolean(error);
  const describedBy =
    [help ? helpId : null, hasError ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const field: FieldControlProps = {
    id: fieldId,
    'aria-describedby': describedBy,
    'aria-invalid': hasError || undefined,
    'aria-required': required || undefined,
  };

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId} required={required} className={cn(hideLabel && 'sr-only')}>
        {label}
      </Label>

      {children(field)}

      {help && !hasError ? (
        <p id={helpId} className="text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}

      {hasError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
};
