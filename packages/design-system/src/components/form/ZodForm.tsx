import * as React from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type Resolver,
  type SubmitHandler,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '../Alert';
import { Button, type ButtonProps } from '../Button';
import { cn } from '../../lib/utils';

/**
 * Thin wrapper around `zodResolver` that isolates a Zod version-skew typing
 * quirk in `@hookform/resolvers` v5 when multiple zod versions coexist in the
 * workspace (v3 + v4). The runtime behaviour is identical; we only widen the
 * static type so the app code compiles cleanly.
 */
export function createZodResolver<TOutput extends Record<string, any>>(
  schema: ZodType<any, any, any>
): Resolver<TOutput> {
  return zodResolver(schema as any) as unknown as Resolver<TOutput>;
}

export interface ZodFormProps<TSchema extends ZodType<any, any, any>>
  extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit' | 'children'> {
  /** Zod schema driving validation and typed field access */
  schema: TSchema;
  /** Default values for the form fields */
  defaultValues?: DefaultValues<TSchema['_output']>;
  /** Submit handler. Called after schema validation succeeds. */
  onSubmit: SubmitHandler<TSchema['_output']>;
  /**
   * Children. May be a render prop receiving the form instance or regular
   * ReactNodes. When not a render prop, fields access the form via
   * `useFormContext` or `useFormState`.
   */
  children:
    | React.ReactNode
    | ((form: UseFormReturn<TSchema['_output']>) => React.ReactNode);
  /** Additional useForm options (mode, reValidateMode, etc.) */
  formOptions?: Omit<UseFormProps<TSchema['_output']>, 'resolver' | 'defaultValues'>;
  /** Show a top-level alert when submission throws. Defaults to true. */
  showErrorAlert?: boolean;
  /** Optional title shown above the error alert */
  errorTitle?: string;
}

/**
 * Generic Zod-validated form wrapper.
 *
 * Wraps react-hook-form + zodResolver, provides FormProvider so fields can
 * access the form state via `useFormContext` or `register`. Submission errors
 * thrown by `onSubmit` are captured and surfaced via an Alert.
 *
 * The submit button inside the form can read `formState.isSubmitting` to
 * disable itself, or the standard pattern is:
 *
 * ```tsx
 * <ZodForm schema={schema} onSubmit={handleSubmit}>
 *   <FormField name="email" label="Email">
 *     <Input {...register('email')} />
 *   </FormField>
 *   <SubmitButton>Save</SubmitButton>
 * </ZodForm>
 * ```
 */
function ZodForm<TSchema extends ZodType<any, any, any>>({
  schema,
  defaultValues,
  onSubmit,
  children,
  formOptions,
  showErrorAlert = true,
  errorTitle = 'Something went wrong',
  className,
  ...formProps
}: ZodFormProps<TSchema>) {
  const form = useForm<TSchema['_output']>({
    ...formOptions,
    resolver: createZodResolver<TSchema['_output']>(schema),
    defaultValues,
  });

  const [submissionError, setSubmissionError] = React.useState<string | null>(null);

  const handleSubmit = form.handleSubmit(async (values) => {
    setSubmissionError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
      setSubmissionError(message);
      // Do not rethrow — error surfaced inline via Alert
    }
  });

  return (
    <FormProvider {...form}>
      <form
        onSubmit={handleSubmit}
        noValidate
        className={cn('space-y-4', className)}
        {...formProps}
      >
        {showErrorAlert && submissionError && (
          <Alert variant="error">
            <AlertTitle>{errorTitle}</AlertTitle>
            <AlertDescription>{submissionError}</AlertDescription>
          </Alert>
        )}
        {typeof children === 'function' ? children(form) : children}
      </form>
    </FormProvider>
  );
}

/**
 * Submit button that automatically disables itself while the form is submitting.
 * Must be rendered inside a ZodForm (or any FormProvider).
 */
export interface SubmitButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingLabel?: string;
}

const SubmitButton = React.forwardRef<
  HTMLButtonElement,
  SubmitButtonProps & Omit<ButtonProps, 'type'>
>(({ children, pendingLabel, disabled, ...props }, ref) => {
  const ctx = useFormContext();
  const isSubmitting = ctx?.formState?.isSubmitting ?? false;
  return (
    <Button ref={ref} type="submit" disabled={disabled || isSubmitting} {...props}>
      {isSubmitting && pendingLabel ? pendingLabel : children}
    </Button>
  );
});
SubmitButton.displayName = 'SubmitButton';

export { ZodForm, SubmitButton };
