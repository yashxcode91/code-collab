import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { LoginSchema, type LoginInput } from '@codecollab/shared';
import { BrandMark } from '@/components/BrandLogo';
import { AuthCenteredLayout } from '@/components/auth/AuthCenteredLayout';
import {
  getOAuthErrorMessage,
  OAuthButtons,
  type OAuthProvider,
  PasswordField,
  TextField,
} from '@/components/auth/AuthFormControls';
import { ApiClientError, useAuth } from '@/context/AuthContext';

type LoginFieldErrors = Partial<Record<keyof LoginInput, string>>;

/**
 * Sign-in page supporting both local email/username credentials and Google/GitHub OAuth.
 * Validates inputs client-side with shared `LoginSchema` before submitting to `/api/auth/login`.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { login } = useAuth();

  const [form, setForm] = useState<LoginInput>({
    identifier: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

  // Read `?error=...` injected by OAuth callback redirects (if provider login failed/canceled)
  const oauthError = getOAuthErrorMessage(searchParams.get('error'));

  // Strip `?error=...` from the browser URL as soon as the user retries or dismisses
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
    // Full-page navigation (not fetch) because `/api/auth/:provider` sets a cookie and 302-redirects to Google/GitHub
    window.location.assign(`/api/auth/${provider}`);
  };

  // Clear field-specific validation feedback as soon as the user starts typing again
  const updateField = <K extends keyof LoginInput>(key: K, value: string) => {
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

    // 1. Validate locally with shared LoginSchema before hitting the network
    const parsed = LoginSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: LoginFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LoginInput | undefined;
        if (key && !nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    // 2. Call AuthContext.login() -> POST /api/auth/login -> redirect to workspace hub
    setIsSubmitting(true);
    try {
      await login(parsed.data);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (Object.keys(err.fieldErrors).length > 0) {
          setFieldErrors(err.fieldErrors as LoginFieldErrors);
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
      <div className="space-y-6">
        {/* Centered Header Jewel */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <BrandMark size="lg" />
          <div className="space-y-1">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-foreground">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your CodeCollab workspace to continue building.
            </p>
          </div>
        </div>

        {/* Google & GitHub OAuth 2.0 Sign-In */}
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
            or continue with
          </span>
          <div className="h-px flex-1 bg-slate-900/10 dark:bg-white/[0.12]" />
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
            id="login-identifier"
            label="Email or username"
            type="text"
            value={form.identifier}
            onChange={(val) => updateField('identifier', val)}
            placeholder="you@example.com or yash_91"
            error={fieldErrors.identifier}
            autoComplete="username"
            autoFocus
          />

          <PasswordField
            id="login-password"
            label="Password"
            value={form.password}
            onChange={(val) => updateField('password', val)}
            showPassword={showPassword}
            onToggleVisibility={() => setShowPassword((prev) => !prev)}
            placeholder="Enter your password"
            error={fieldErrors.password}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={isSubmitting || pendingProvider !== null}
            className="group mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-violet-600 to-violet-700 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_2px_4px_rgba(15,23,42,0.12),0_10px_24px_-6px_rgba(109,40,217,0.45)] transition-all duration-150 hover:from-violet-500 hover:to-violet-700 active:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-60 dark:from-indigo-500 dark:to-indigo-600 dark:hover:from-indigo-400 dark:hover:to-indigo-600 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_6px_rgba(0,0,0,0.4),0_12px_28px_-6px_rgba(99,102,241,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Sign in</span>
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </form>

        {/* Registration Link */}
        <p className="text-center text-sm text-muted-foreground">
          New to CodeCollab?{' '}
          <Link
            to="/register"
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </div>
    </AuthCenteredLayout>
  );
}

