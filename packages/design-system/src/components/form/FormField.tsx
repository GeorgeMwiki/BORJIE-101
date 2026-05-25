import * as React from 'react';
import { useFormContext, get, type FieldValues, type FieldPath } from 'react-hook-form';
import { cn } from '../../lib/utils';
import { Label } from '../Label';

export interface FormFieldProps<TFieldValues extends FieldValues = FieldValues>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Label text shown above the field */
  label?: string;
  /** htmlFor attribute; falls back to `name` when inside a ZodForm */
  htmlFor?: string;
  /** Explicit error override; when inside a ZodForm the error is pulled from formState */
  error?: string;
  /** Optional hint text below the field */
  hint?: string;
  /** Mark the field visually as required */
  required?: boolean;
  /**
   * Name of the form field. When provided and the component is rendered inside a
   * `ZodForm` (FormProvider), the error is pulled automatically from
   * `formState.errors[name]` and `htmlFor` is derived from the name.
   */
  name?: FieldPath<TFieldValues>;
  /** Render prop or regular children. Use children directly for normal usage. */
  children?: React.ReactNode;
}

/**
 * FormField renders a label, child control, and either an error or hint.
 *
 * Two supported integration patterns:
 *  1. Uncontrolled/controlled with explicit `error` prop — legacy pattern.
 *  2. Inside a `ZodForm` (react-hook-form FormProvider) with `name` prop —
 *     pulls error from form state automatically.
 */
const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ className, label, htmlFor, error, hint, required, name, children, ...props }, ref) => {
    const context = useFormContext();
    const contextError =
      context && name ? (get(context.formState.errors, name)?.message as string | undefined) : undefined;

    const resolvedError = error ?? contextError;
    const resolvedHtmlFor = htmlFor ?? name;

    return (
      <div ref={ref} className={cn('space-y-2', className)} {...props}>
        {label && (
          <Label htmlFor={resolvedHtmlFor} required={required}>
            {label}
          </Label>
        )}
        {children}
        {resolvedError && (
          <p className="text-sm text-destructive" role="alert">
            {resolvedError}
          </p>
        )}
        {hint && !resolvedError && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
    );
  }
);
FormField.displayName = 'FormField';

export { FormField };
