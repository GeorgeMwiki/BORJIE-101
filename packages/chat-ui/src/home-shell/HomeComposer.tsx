/**
 * HomeComposer — sticky bottom composer for HomeShell.
 *
 * Renderer-pure; sends via the supplied onSend callback. Honours
 * Enter-to-send, Shift+Enter for newline. Disabled while streaming.
 *
 * Spec: HOME_DASHBOARD_STANDARD §8.
 */

import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

export interface HomeComposerProps {
  readonly onSend: (text: string) => void | Promise<void>;
  readonly disabled: boolean;
  readonly placeholder: string;
  readonly testId?: string | undefined;
}

const WRAPPER_STYLE: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  left: 0,
  right: 0,
  padding: '12px 16px',
  background: 'var(--color-background, #ffffff)',
  borderTop: '1px solid var(--color-border, #e5e7eb)',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};

const TEXTAREA_STYLE: CSSProperties = {
  flex: 1,
  resize: 'none',
  minHeight: 44,
  maxHeight: 160,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--color-border, #e5e7eb)',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: 1.5,
  background: 'var(--color-background, #ffffff)',
  color: 'var(--color-foreground, #0f172a)',
};

const BUTTON_STYLE: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #C9A66B 0%, #8B6914 100%)',
  color: '#17100A',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

export function HomeComposer(props: HomeComposerProps): JSX.Element {
  const { onSend, disabled, placeholder, testId = 'home-composer' } = props;
  const [value, setValue] = useState('');

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setValue('');
    await onSend(trimmed);
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  return (
    <div data-testid={testId} style={WRAPPER_STYLE}>
      <textarea
        data-testid="home-composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={TEXTAREA_STYLE}
        rows={1}
      />
      <button
        type="button"
        data-testid="home-composer-send"
        onClick={() => void submit()}
        disabled={disabled || value.trim().length === 0}
        style={BUTTON_STYLE}
      >
        Send
      </button>
    </div>
  );
}
