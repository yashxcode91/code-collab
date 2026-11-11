import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Code2,
  Globe,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  COLLAB_LIMITS,
  CreateProjectSchema,
  type ProjectDetailResponse,
  type SupportedLanguage,
} from '@codecollab/shared';
import type { TemplatePreset } from '@/components/studio-ui/GlassySidebar';
import { ApiClientError } from '@/lib/api';
import { createProject, queryKeys } from '@/lib/queries';

const LANGUAGE_OPTIONS: Array<{ value: SupportedLanguage; label: string }> = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
];

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  preset?: TemplatePreset | null;
  onCreated?: (detail: ProjectDetailResponse) => void;
}

/**
 * Crystal `.glass-mirror` modal dialog for creating new collaborative project repositories.
 * Validates inputs synchronously with the shared `@codecollab/shared` `CreateProjectSchema`
 * before firing React Query's `createProject` mutation and invalidating `queryKeys.projects.all`.
 */
export function CreateWorkspaceModal({
  open,
  onClose,
  preset,
  onCreated,
}: CreateWorkspaceModalProps) {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<SupportedLanguage>('typescript');
  const [isPublic, setIsPublic] = useState(false);
  const [maxConcurrentEditors, setMaxConcurrentEditors] = useState<number>(
    COLLAB_LIMITS.DEFAULT_CONCURRENT_EDITORS,
  );
  const [preventSameLineEdit, setPreventSameLineEdit] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sync preset template fields or clear form whenever modal opens
  useEffect(() => {
    if (!open) return;
    setName(preset?.name ?? '');
    setDescription(preset?.description ?? '');
    setLanguage(preset?.language ?? 'typescript');
    setIsPublic(false);
    setMaxConcurrentEditors(COLLAB_LIMITS.DEFAULT_CONCURRENT_EDITORS);
    setPreventSameLineEdit(preset?.preventSameLineEdit ?? false);
    setFieldErrors({});
    setSubmitError(null);
  }, [open, preset]);

  // Close modal cleanly via Escape key when idle
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: async (detail) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
      onCreated?.(detail);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fieldErrors);
        setSubmitError(err.message);
      } else {
        setSubmitError(
          err instanceof Error ? err.message : 'Unable to create workspace',
        );
      }
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFieldErrors({});
    setSubmitError(null);

    const parsed = CreateProjectSchema.safeParse({
      name,
      description: description.trim() || undefined,
      language,
      isPublic,
      maxConcurrentEditors,
      preventSameLineEdit,
    });

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'name');
        if (!nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }

    mutation.mutate(parsed.data);
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-workspace-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="glass-mirror relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6 sm:p-7"
          >
            <div className="relative z-10 space-y-5">
              {/* Modal Title Row */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                    <Code2 className="h-3 w-3" aria-hidden="true" />
                    <span>New Repository</span>
                  </span>
                  <h2
                    id="create-workspace-title"
                    className="mt-1 text-lg font-semibold tracking-tight text-foreground"
                  >
                    Create Collaborative Workspace
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close modal"
                  className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {submitError && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Workspace Name */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="ws-name"
                    className="block text-xs font-medium text-foreground"
                  >
                    Workspace name
                  </label>
                  <input
                    id="ws-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. realtime-kanban-engine"
                    autoFocus
                    className="glass-control w-full rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/65 focus:border-primary/60 focus:outline-none"
                  />
                  {fieldErrors.name && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                {/* Optional Description */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="ws-desc"
                    className="block text-xs font-medium text-foreground"
                  >
                    Description{' '}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    id="ws-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What will your team build in this room?"
                    className="glass-control w-full resize-none rounded-xl px-3.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/65 focus:border-primary/60 focus:outline-none"
                  />
                  {fieldErrors.description && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.description}
                    </p>
                  )}
                </div>

                {/* Language Selector Pills */}
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-foreground">
                    Primary runtime language
                  </span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {LANGUAGE_OPTIONS.map((opt) => {
                      const active = language === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setLanguage(opt.value)}
                          className={`rounded-xl px-2.5 py-2 font-mono text-[11px] font-medium transition-all ${
                            active
                              ? 'border border-primary/60 bg-primary/15 text-primary shadow-sm'
                              : 'glass-control text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Visibility & Concurrency Settings */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-foreground">
                      Visibility
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPublic(false)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-all ${
                          !isPublic
                            ? 'border border-primary/50 bg-primary/15 text-primary'
                            : 'glass-control text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Private
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPublic(true)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-medium transition-all ${
                          isPublic
                            ? 'border border-primary/50 bg-primary/15 text-primary'
                            : 'glass-control text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Globe className="h-3 w-3" aria-hidden="true" />
                        Public
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="ws-editors"
                        className="font-medium text-foreground"
                      >
                        Concurrent editors
                      </label>
                      <span className="font-mono font-semibold text-primary">
                        {maxConcurrentEditors}
                      </span>
                    </div>
                    <input
                      id="ws-editors"
                      type="range"
                      min={COLLAB_LIMITS.MIN_CONCURRENT_EDITORS}
                      max={COLLAB_LIMITS.MAX_CONCURRENT_EDITORS}
                      value={maxConcurrentEditors}
                      onChange={(e) =>
                        setMaxConcurrentEditors(Number(e.target.value))
                      }
                      className="h-9 w-full accent-[hsl(var(--primary))]"
                    />
                  </div>
                </div>

                {/* Same-Line Collaboration Guardrail Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={preventSameLineEdit}
                  onClick={() => setPreventSameLineEdit((prev) => !prev)}
                  className="glass-control flex w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck
                      className={`h-4 w-4 ${preventSameLineEdit ? 'text-primary' : 'text-muted-foreground'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <span className="block text-xs font-medium text-foreground">
                        Prevent same-line conflicts
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        Lock active line exclusively while typing
                      </span>
                    </div>
                  </div>
                  <span
                    className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                      preventSameLineEdit
                        ? 'bg-primary'
                        : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        preventSameLineEdit ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </span>
                </button>

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="glass-control rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={mutation.isPending}
                    className="btn-studio-primary inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-60"
                  >
                    {mutation.isPending && (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {mutation.isPending
                        ? 'Provisioning…'
                        : 'Create Workspace'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
