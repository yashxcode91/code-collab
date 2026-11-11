import { Eye, EyeOff, Github, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export function inputClassName(hasError: boolean, extra?: string) {
  return cn(
    'flex h-11 w-full rounded-xl border px-3.5 text-sm text-foreground',
    'bg-white/60 backdrop-blur-sm shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),0_1px_0_rgba(255,255,255,0.7)]',
    'dark:bg-white/[0.055] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28),0_1px_0_rgba(255,255,255,0.05)]',
    'placeholder:text-muted-foreground/70',
    'transition-all duration-150',
    'focus:outline-none focus:ring-[3px] focus:ring-offset-0 focus:bg-white/90 dark:focus:bg-white/[0.1]',
    hasError
      ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
      : 'border-slate-900/15 hover:border-slate-900/25 focus:border-primary focus:ring-primary/15 dark:border-white/[0.15] dark:hover:border-white/30',
    extra,
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'email';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}

export function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  hint,
  autoComplete,
  autoFocus,
}: TextFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={inputClassName(Boolean(error))}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggleVisibility?: () => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  autoComplete?: string;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  showPassword,
  onToggleVisibility,
  placeholder,
  error,
  hint,
  autoComplete,
}: PasswordFieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-foreground"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={inputClassName(Boolean(error), onToggleVisibility ? 'pr-10' : undefined)}
        />
        {onToggleVisibility && (
          <button
            type="button"
            onClick={onToggleVisibility}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className={cn(
              'absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1',
              'text-muted-foreground hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'transition-colors',
            )}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface OAuthButtonsProps {
  onSelectProvider: (provider: 'Google' | 'GitHub') => void;
  notice: string | null;
}

export function OAuthButtons({ onSelectProvider, notice }: OAuthButtonsProps) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onSelectProvider('Google')}
          className={cn(
            'inline-flex h-11 items-center justify-center gap-2 rounded-xl',
            'border border-slate-900/15 bg-white/60 px-3 text-[13px] font-medium text-foreground backdrop-blur-sm',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(15,23,42,0.04)]',
            'hover:-translate-y-[0.5px] hover:border-slate-900/25 hover:bg-white/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_4px_12px_-2px_rgba(15,23,42,0.08)]',
            'active:translate-y-0',
            'dark:border-white/[0.15] dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
            'dark:hover:border-white/30 dark:hover:bg-white/[0.11]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'transition-all duration-150',
          )}
        >
          <GoogleIcon />
          <span>Google</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectProvider('GitHub')}
          className={cn(
            'inline-flex h-11 items-center justify-center gap-2 rounded-xl',
            'border border-slate-900/15 bg-white/60 px-3 text-[13px] font-medium text-foreground backdrop-blur-sm',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(15,23,42,0.04)]',
            'hover:-translate-y-[0.5px] hover:border-slate-900/25 hover:bg-white/90 hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_4px_12px_-2px_rgba(15,23,42,0.08)]',
            'active:translate-y-0',
            'dark:border-white/[0.15] dark:bg-white/[0.06] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
            'dark:hover:border-white/30 dark:hover:bg-white/[0.11]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'transition-all duration-150',
          )}
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          <span>GitHub</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-primary/25 bg-accent px-3 py-2 text-xs text-accent-foreground"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

