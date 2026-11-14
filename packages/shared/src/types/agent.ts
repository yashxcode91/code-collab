/**
 * Global operational limits and constraints for Day 8 Autonomous Multi-File Agents.
 */
export const AGENT_LIMITS = {
  MAX_PROMPT_CHARS: 5_000,
  MAX_TITLE_CHARS: 120,
  MAX_SESSION_STEPS: 20,
  MAX_TOOL_CALLS_PER_SESSION: 50,
  MAX_STAGED_FILES: 25,
  MAX_SELF_HEALING_ATTEMPTS: 3,
  MAX_FILE_READ_BYTES: 200 * 1024, // 200 KB max per file read
  MAX_FILE_WRITE_BYTES: 500 * 1024, // 500 KB max per file write
  MAX_TOOL_EXECUTION_TIMEOUT_MS: 30_000, // 30s per tool invocation
  DEFAULT_MODEL: 'gemini-1.5-pro',
} as const;

export type AgentSessionStatusDto =
  | 'PLANNING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'SELF_HEALING'
  | 'AWAITING_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type AgentStepStatusDto =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export type AgentToolStatusDto =
  | 'RUNNING'
  | 'SUCCESS'
  | 'ERROR';

export type AgentFileChangeTypeDto =
  | 'CREATE'
  | 'MODIFY'
  | 'DELETE';

export type AgentToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_codebase'
  | 'list_directory'
  | 'run_verification';

export interface AgentPlanStepDto {
  id: string;
  sessionId: string;
  stepNumber: number;
  title: string;
  description: string;
  status: AgentStepStatusDto;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolCallDto {
  id: string;
  sessionId: string;
  stepId?: string | null;
  toolName: string;
  inputPayload: Record<string, unknown>;
  outputPayload?: Record<string, unknown> | null;
  status: AgentToolStatusDto;
  errorMessage?: string | null;
  durationMs?: number | null;
  createdAt: string;
}

export interface AgentStagedFileDto {
  id: string;
  sessionId: string;
  fileId?: string | null;
  filePath: string;
  changeType: AgentFileChangeTypeDto;
  originalContent?: string | null;
  stagedContent: string;
  originalVersion?: number | null;
  originalContentHash?: string | null;
  isApplied: boolean;
  hasConflict: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionSummaryDto {
  id: string;
  projectId: string;
  branchId: string;
  userId: string;
  title: string;
  prompt: string;
  status: AgentSessionStatusDto;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  selfHealingAttempts: number;
  maxSelfHealingAttempts: number;
  errorMessage?: string | null;
  expiresAt?: string | null;
  cancelledAt?: string | null;
  totalSteps: number;
  completedSteps: number;
  stagedFilesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionDetailDto {
  id: string;
  projectId: string;
  branchId: string;
  userId: string;
  title: string;
  prompt: string;
  status: AgentSessionStatusDto;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  selfHealingAttempts: number;
  maxSelfHealingAttempts: number;
  errorMessage?: string | null;
  expiresAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
  steps: AgentPlanStepDto[];
  toolCalls: AgentToolCallDto[];
  stagedFiles: AgentStagedFileDto[];
}

export interface AgentCreateSessionRequestDto {
  prompt: string;
  title?: string;
  model?: string;
}

export interface AgentApplyStagedFilesRequestDto {
  filePaths?: string[]; // If omitted or empty, applies all staged files
}

export interface AgentDiscardStagedFilesRequestDto {
  filePaths?: string[]; // If omitted or empty, discards all staged files
}

export interface AgentVerificationDiagnostic {
  filePath: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
}

export interface AgentVerificationResultDto {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  diagnostics: AgentVerificationDiagnostic[];
}

// SSE Stream Events emitted during agent execution
export type AgentStreamEventDto =
  | {
      type: 'session_status';
      sessionId: string;
      status: AgentSessionStatusDto;
      message?: string;
    }
  | {
      type: 'plan_created';
      sessionId: string;
      steps: AgentPlanStepDto[];
    }
  | {
      type: 'step_started';
      sessionId: string;
      stepNumber: number;
      title: string;
    }
  | {
      type: 'step_completed';
      sessionId: string;
      stepNumber: number;
      status: AgentStepStatusDto;
      errorMessage?: string | null;
    }
  | {
      type: 'tool_call_started';
      sessionId: string;
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_call_finished';
      sessionId: string;
      toolCallId: string;
      toolName: string;
      status: AgentToolStatusDto;
      durationMs: number;
      output?: Record<string, unknown>;
      error?: string;
    }
  | {
      type: 'file_staged';
      sessionId: string;
      file: AgentStagedFileDto;
    }
  | {
      type: 'self_healing_attempt';
      sessionId: string;
      attempt: number;
      maxAttempts: number;
      errorSummary: string;
    }
  | {
      type: 'verification_result';
      sessionId: string;
      result: AgentVerificationResultDto;
    }
  | {
      type: 'done';
      sessionId: string;
      status: AgentSessionStatusDto;
      totalFilesStaged: number;
    }
  | {
      type: 'error';
      sessionId: string;
      message: string;
    };
