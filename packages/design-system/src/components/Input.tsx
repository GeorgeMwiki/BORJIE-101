import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

export type InputType = 'text' | 'email' | 'phone' | 'password' | 'number' | 'search' | 'url';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Input variant: text, email, phone, password, number, search, url */
  inputType?: InputType;
  /** Native HTML input type - overrides inputType when set */
  type?: React.InputHTMLAttributes<HTMLInputElement>['type'];
  /** Show error state styling */
  error?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Helper text below input */
  helperText?: string;
  /** Icon on the left side of input */
  leftIcon?: React.ReactNode;
  /** Icon on the right side of input */
  rightIcon?: React.ReactNode;
  /** Label for the input */
  label?: string;
  /** Required field indicator */
  required?: boolean;
  /** Input size variant */
  inputSize?: 'sm' | 'default' | 'lg';
  /** Accessible label for screen readers */
  'aria-label'?: string;
}

const inputTypeConfig: Record<
  InputType,
  {
    type: React.HTMLInputTypeAttribute;
    autoComplete?: string;
    inputMode?: 'decimal' | 'numeric' | 'none' | 'search' | 'text' | 'tel' | 'url' | 'email';
  }
> = {
  text: { type: 'text', autoComplete: 'off' },
  email: { type: 'email', autoComplete: 'email', inputMode: 'email' },
  phone: { type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
  password: { type: 'password', autoComplete: 'current-password' },
  number: { type: 'number', inputMode: 'numeric' },
  search: { type: 'search', autoComplete: 'off' },
  url: { type: 'url', autoComplete: 'url', inputMode: 'url' },
};

const sizeClasses = {
  sm: 'h-8 text-xs px-2',
  default: 'h-10 text-sm px-3',
  lg: 'h-12 text-base px-4',
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type: typeProp,
      inputType = 'text',
      error,
      errorMessage,
      helperText,
      leftIcon,
      rightIcon,
      label,
      required,
      inputSize = 'default',
      id,
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const inputId = id || React.useId();
    const config = inputTypeConfig[inputType];
    const isPassword = inputType === 'password';
    const resolvedType = typeProp ?? (isPassword && showPassword ? 'text' : config.type);

    const inputProps = {
      ...(typeProp ? {} : { autoComplete: config.autoComplete, inputMode: config.inputMode }),
    };

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </label>
        )}
        <div className="relative w-full">
          {leftIcon && (
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            >
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            type={resolvedType}
            className={cn(
              'flex w-full rounded-md border border-input bg-background py-2 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              sizeClasses[inputSize],
              error && 'border-destructive focus-visible:ring-destructive',
              leftIcon && 'pl-10',
              (rightIcon || isPassword) && 'pr-10',
              className
            )}
            ref={ref}
            aria-invalid={error}
            aria-label={ariaLabel}
            aria-describedby={
              error && errorMessage
                ? `${inputId}-error`
                : helperText
                ? `${inputId}-helper`
                : undefined
            }
            required={required}
            {...inputProps}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
          {rightIcon && !isPassword && (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            >
              {rightIcon}
            </div>
          )}
        </div>
        {error && errorMessage && (
          <p id={`${inputId}-error`} className="mt-1.5 text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        {!error && helperText && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-muted-foreground">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

/** Textarea component with validation support */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Show error state styling */
  error?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Helper text below textarea */
  helperText?: string;
  /** Label for the textarea */
  label?: string;
  /** Required field indicator */
  required?: boolean;
  /** Auto-resize based on content */
  autoResize?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      error,
      errorMessage,
      helperText,
      label,
      required,
      autoResize = false,
      id,
      onChange,
      ...props
    },
    ref
  ) => {
    const textareaId = id || React.useId();
    const internalRef = React.useRef<HTMLTextAreaElement>(null);
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;

    const handleResize = React.useCallback(() => {
      if (autoResize && textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }, [autoResize, textareaRef]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleResize();
      onChange?.(e);
    };

    React.useEffect(() => {
      handleResize();
    }, [handleResize]);

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </label>
        )}
        <textarea
          id={textareaId}
          className={cn(
            'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-destructive focus-visible:ring-destructive',
            autoResize && 'resize-none overflow-hidden',
            className
          )}
          ref={textareaRef}
          aria-invalid={error}
          aria-describedby={
            error && errorMessage
              ? `${textareaId}-error`
              : helperText
              ? `${textareaId}-helper`
              : undefined
          }
          required={required}
          onChange={handleChange}
          {...props}
        />
        {error && errorMessage && (
          <p id={`${textareaId}-error`} className="mt-1.5 text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        {!error && helperText && (
          <p id={`${textareaId}-helper`} className="mt-1.5 text-xs text-muted-foreground">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
