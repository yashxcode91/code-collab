import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { RegisterSchema, type RegisterInput } from '@codecollab/shared';
import { BrandMark } from '@/components/BrandLogo';
import { AuthCenteredLayout } from '@/components/auth/AuthCenteredLayout';
import {
  getOAuthErrorMessage,
  OAuthButtons,
  type OAuthProvider,
  PasswordField,
  TextField,
} from '@/components/auth/AuthFormControls';
import {
  ApiClientError,
  OAUTH_PROVIDER_STORAGE_KEY,
  useAuth,
} from '@/context/AuthContext';

type RegisterFormState = RegisterInput & { confirmPassword: string };
type RegisterFieldErrors = Partial<Record<keyof RegisterFormState, string>>;

/**
 * Sign-up page supporting local registration and Google/GitHub OAuth.
 * Validates account fields with shared `RegisterSchema` plus client-only `confirmPassword` match.
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { register } = useAuth();

  const [form, setForm] = useState<RegisterFormState>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});

  const oauthError = getOAuthErrorMessage(searchParams.get('error'));

  const clearOAuthError = () => {
    if (searchParams.has('error')) {
      const next = new URLSearchParams(searchParams);
      next.delete('error');
      setSearchParams(next, { replace: true });
    }
  };

  const handleOAuthSelect = (provider: OAuthProvider) => {
    setGlobalError(null);
    clearOAuthError();
    setPendingProvider(provider);
    try {
      window.localStorage.setItem(OAUTH_PROVIDER_STORAGE_KEY, provider);
    } catch {
      // Ignore storage access errors in restricted/private environments
    }
    // Full browser redirect required so OAuth cookie + 302 consent flow works cleanly
    window.location.assign(`/api/auth/${provider}`);
  };

  const updateField = <K extends keyof RegisterFormState>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
    if (globalError) setGlobalError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    clearOAuthError();
    setFieldErrors({});

    // Strip frontend-only `confirmPassword` before running shared backend/frontend `RegisterSchema`
    const { confirmPassword, ...payload } = form;
    const parsed = RegisterSchema.safeParse(payload);
    const nextErrors: RegisterFieldErrors = {};

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof RegisterInput | undefined;
        if (key && !nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
    }

    // Validate password confirmation locally (never sent over HTTP)
    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Please confirm your password';
    } else if (form.password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(nextErrors).length > 0 || !parsed.success) {
      setFieldErrors(nextErrors);
      return;
    }

    // Submit validated registration -> sets HttpOnly JWT cookie -> redirect into workspace hub
    setIsSubmitting(true);
    try {
      await register(parsed.data);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (Object.keys(err.fieldErrors).length > 0) {
          setFieldErrors(err.fieldErrors as RegisterFieldErrors);
        } else {
          setGlobalError(err.message);
        }
      } else {
        setGlobalError('Unable to reach server. Check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCenteredLayout>
      <div className="space-y-5">
        {/* Centered Header Jewel */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <BrandMark size="lg" />
          <div className="space-y-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-foreground">
              Create your account
            </h1>
            <p className="text-sm text-muted-foreground">
              Start collaborating in real time with your engineering team.
            </p>
          </div>
        </div>

        {/* Google & GitHub OAuth 2.0 Sign-Up */}
        <OAuthButtons
          onSelectProvider={handleOAuthSelect}
          pendingProvider={pendingProvider}
          disabled={isSubmitting}
          error={oauthError}
          onDismissError={clearOAuthError}
        />

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/[0.12]" />
          <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/80">
            or register with email
          </span>
          <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/[0.12]" />
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          {globalError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{globalError}</span>
            </div>
          )}

          <TextField
            id="register-username"
            label="Username"
            type="text"
            value={form.username}
            onChange={(val) => updateField('username', val)}
            placeholder="yash_91"
            hint="3–20 lowercase letters, numbers, or underscores"
            error={fieldErrors.username}
            autoComplete="username"
            autoFocus
          />

          <TextField
            id="register-email"
            label="Email address"
            type="email"
            value={form.email}
            onChange={(val) => updateField('email', val)}
            placeholder="you@example.com"
            error={fieldErrors.email}
            autoComplete="email"
          />

          <PasswordField
            id="register-password"
            label="Password"
            value={form.password}
            onChange={(val) => updateField('password', val)}
            showPassword={showPassword}
            onToggleVisibility={() => setShowPassword((prev) => !prev)}
            placeholder="Create a password"
            hint="At least 8 characters"
            error={fieldErrors.password}
            autoComplete="new-password"
          />

          <PasswordField
            id="register-confirm-password"
            label="Confirm password"
            value={form.confirmPassword}
            onChange={(val) => updateField('confirmPassword', val)}
            showPassword={showPassword}
            placeholder="Repeat your password"
            error={fieldErrors.confirmPassword}
            autoComplete="new-password"
          />

          <button
            type="submit"
            disabled={isSubmitting || pendingProvider !== null}
            className="btn-studio-primary group mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-all duration-150 active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Creating account…</span>
              </>
            ) : (
              <>
                <span>Create account</span>
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </form>

        {/* Login Link */}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthCenteredLayout>
  );
}

