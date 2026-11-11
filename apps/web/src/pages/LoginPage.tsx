import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { LoginSchema, type LoginInput } from '@codecollab/shared';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import {
  OAuthButtons,
  PasswordField,
  TextField,
} from '@/components/auth/AuthFormControls';
import { ApiClientError, useAuth } from '@/context/AuthContext';

type LoginFieldErrors = Partial<Record<keyof LoginInput, string>>;

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState<LoginInput>({
    identifier: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

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
    setFieldErrors({});

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
    <AuthSplitLayout>
      <div className="space-y-6">
        {/* Heading */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your CodeCollab workspace to continue building.
          </p>
        </div>

        {/* OAuth Placeholders (wired in Step 7) */}
        <OAuthButtons
          onSelectProvider={(provider) =>
            setOauthNotice(
              `${provider} OAuth sign-in will be connected in Step 7. Use your email or username below for now.`,
            )
          }
          notice={oauthNotice}
        />

        {/* Divider */}
        <div className="relative flex items-center">
          <div className="w-full border-t border-border" />
          <span className="shrink-0 bg-background px-3 text-xs text-muted-foreground">
            or continue with credentials
          </span>
          <div className="w-full border-t border-border" />
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {globalError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
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
            disabled={isSubmitting}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Sign in</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
    </AuthSplitLayout>
  );
}

