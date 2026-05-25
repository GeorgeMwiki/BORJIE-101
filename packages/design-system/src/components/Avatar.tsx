import * as React from 'react';
import { cn, getInitials } from '../lib/utils';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
};

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, name, size = 'md', ...props }, ref) => {
    const [hasError, setHasError] = React.useState(false);

    const showFallback = !src || hasError;
    const initials = name ? getInitials(name) : '?';

    return (
      <div
        ref={ref}
        role="img"
        aria-label={alt || name || 'User avatar'}
        className={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {showFallback ? (
          <span className="font-medium text-muted-foreground">{initials}</span>
        ) : (
          <img
            src={src}
            alt={alt || name || 'Avatar'}
            className="aspect-square h-full w-full object-cover"
            onError={() => setHasError(true)}
          />
        )}
      </div>
    );
  }
);
Avatar.displayName = 'Avatar';

export { Avatar };
