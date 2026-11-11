import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { RegisterSchema, type RegisterInput } from '@codecollab/shared';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import {
  OAuthButtons,
  PasswordField,
  TextField,
} from '@/components/auth/AuthFormControls';
import { ApiClientError, useAuth } from '@/context/AuthContext';

type RegisterFormState = RegisterInput & { confirmPassword: string };
type RegisterFieldErrors = Partial<Record<keyof RegisterFormState, string>>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [form, setForm] = useState<RegisterFormState>({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});

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
    setFieldErrors({});

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

    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Please confirm your password';
    } else if (form.password !== confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(nextErrors).length > 0 || !parsed.success) {
      setFieldErrors(nextErrors);
      return;
    }

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
    <AuthSplitLayout>
      <div className="space-y-5">
        {/* Heading */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Create your account
          </h1>
          <p className="text-sm text-muted-foreground">
            Start collaborating in real time with your engineering team.
          </p>
        </div>

        {/* OAuth Placeholders (wired in Step 7) */}
        <OAuthButtons
          onSelectProvider={(provider) =>
            setOauthNotice(
              `${provider} OAuth sign-up will be connected in Step 7. Register with email below for now.`,
            )
          }
          notice={oauthNotice}
        />

        {/* Divider */}
        <div className="relative flex items-center">
          <div className="w-full border-t border-border" />
          <span className="shrink-0 bg-background px-3 text-xs text-muted-foreground">
            or register with email
          </span>
          <div className="w-full border-t border-border" />
        </div>

        {/* Registration Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
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
            disabled={isSubmitting}
            className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Creating account…</span>
              </>
            ) : (
              <>
                <span>Create account</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
    </AuthSplitLayout>
  );
}

