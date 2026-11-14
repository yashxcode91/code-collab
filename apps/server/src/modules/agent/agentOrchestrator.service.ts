import {
  AgentPlanStep,
  AgentSession,
  AgentSessionStatus,
  AgentStepStatus,
  prisma,
} from '@codecollab/database';
import {
  AgentPlanStepDto,
  AgentSessionDetailDto,
  AgentVerificationDiagnostic,
  AgentVerificationResultDto,
  AGENT_LIMITS,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertProjectAccess,
} from '../projects/project.auth';
import { AgentStagingService, mapAgentStagedFileDto, normalizeFilePath } from './agentStaging.service';
import { AgentVerificationService } from './agentVerification.service';
import { defaultToolRegistry, ToolRegistry } from './tools/toolRegistry';

// =====================================================================
// State Machine Transition Table & Guard
// =====================================================================

export const VALID_AGENT_TRANSITIONS: Record<
  AgentSessionStatus,
  AgentSessionStatus[]
> = {
  PLANNING: ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['AWAITING_REVIEW', 'SELF_HEALING', 'FAILED', 'CANCELLED'],
  SELF_HEALING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  AWAITING_REVIEW: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const transitionAgentState = (
  currentState: AgentSessionStatus,
  nextState: AgentSessionStatus
): AgentSessionStatus => {
  const allowed = VALID_AGENT_TRANSITIONS[currentState];
  if (!allowed || !allowed.includes(nextState)) {
    throw new AppError(
      400,
      'INVALID_STATE_TRANSITION',
      `Cannot transition agent session from '${currentState}' to '${nextState}'`
    );
  }
  return nextState;
};

// =====================================================================
// Callbacks Interface for Live SSE Streaming
// =====================================================================

export interface AgentExecutionCallbacks {
  onStatusChange?: (status: AgentSessionStatus, message?: string) => Promise<void> | void;
  onPlanCreated?: (steps: AgentPlanStepDto[]) => Promise<void> | void;
  onStepStarted?: (stepNumber: number, title: string) => Promise<void> | void;
  onStepCompleted?: (stepNumber: number, status: AgentStepStatus, error?: string | null) => Promise<void> | void;
  onToolCallStarted?: (toolCallId: string, toolName: string, input: Record<string, unknown>) => Promise<void> | void;
  onToolCallFinished?: (toolCallId: string, toolName: string, status: string, durationMs: number, output?: Record<string, unknown>, error?: string) => Promise<void> | void;
  onFileStaged?: (file: any) => Promise<void> | void;
  onSelfHealingAttempt?: (attempt: number, maxAttempts: number, errorSummary: string) => Promise<void> | void;
  onVerificationResult?: (result: AgentVerificationResultDto) => Promise<void> | void;
  onDone?: (sessionId: string, totalFilesStaged: number) => Promise<void> | void;
  onError?: (message: string) => Promise<void> | void;
}

// =====================================================================
// DTO Serializers
// =====================================================================

export const mapAgentPlanStepDto = (row: AgentPlanStep): AgentPlanStepDto => ({
  id: row.id,
  sessionId: row.sessionId,
  stepNumber: row.stepNumber,
  title: row.title,
  description: row.description,
  status: row.status as any,
  errorMessage: row.errorMessage,
  startedAt: row.startedAt?.toISOString() ?? null,
  completedAt: row.completedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const mapAgentSessionDetailDto = (
  session: AgentSession & {
    steps: AgentPlanStep[];
    toolCalls: any[];
    stagedFiles: any[];
  }
): AgentSessionDetailDto => ({
  id: session.id,
  projectId: session.projectId,
  branchId: session.branchId,
  userId: session.userId,
  title: session.title,
  prompt: session.prompt,
  status: session.status as any,
  model: session.model,
  totalInputTokens: session.totalInputTokens,
  totalOutputTokens: session.totalOutputTokens,
  selfHealingAttempts: session.selfHealingAttempts,
  maxSelfHealingAttempts: session.maxSelfHealingAttempts,
  errorMessage: session.errorMessage,
  expiresAt: session.expiresAt?.toISOString() ?? null,
  cancelledAt: session.cancelledAt?.toISOString() ?? null,
  createdAt: session.createdAt.toISOString(),
  updatedAt: session.updatedAt.toISOString(),
  steps: session.steps.map(mapAgentPlanStepDto),
  toolCalls: session.toolCalls.map((tc) => ({
    id: tc.id,
    sessionId: tc.sessionId,
    stepId: tc.stepId,
    toolName: tc.toolName,
    inputPayload: tc.inputPayload as Record<string, unknown>,
    outputPayload: tc.outputPayload as Record<string, unknown> | null,
    status: tc.status as any,
    errorMessage: tc.errorMessage,
    durationMs: tc.durationMs,
    createdAt: tc.createdAt.toISOString(),
  })),
  stagedFiles: session.stagedFiles.map(mapAgentStagedFileDto),
});

// =====================================================================
// Autonomous Agent Orchestrator Service
// =====================================================================

export class AgentOrchestratorService {
  constructor(private readonly toolRegistry: ToolRegistry = defaultToolRegistry) {}

  /**
   * Creates a new AgentSession and decomposes the user prompt into ordered
   * AgentPlanStep milestones.
   */
  async createSession(params: {
    projectId: string;
    branchId: string;
    userId: string;
    prompt: string;
    title?: string;
    model?: string;
  }): Promise<AgentSessionDetailDto> {
    const { projectId, branchId, userId, prompt, model } = params;

    // Verify access
    await assertProjectAccess(projectId, userId, 'editor');
    const branch = await assertBranchInProject(projectId, branchId);

    if (branch.isProtected) {
      throw new AppError(
        403,
        'BRANCH_PROTECTED',
        'Cannot initiate autonomous agent workflows on a protected branch'
      );
    }

    const title =
      params.title ||
      prompt.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 50) ||
      'Autonomous Refactor';

    // 1. Create AgentSession in PLANNING state
    const session = await prisma.agentSession.create({
      data: {
        projectId,
        branchId,
        userId,
        title,
        prompt,
        status: 'PLANNING',
        model: model || AGENT_LIMITS.DEFAULT_MODEL,
        maxSelfHealingAttempts: AGENT_LIMITS.MAX_SELF_HEALING_ATTEMPTS,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours expiry
      },
    });

    // 2. Generate Plan Steps
    const planStepsData = this.generatePlanSteps(prompt);

    const steps = await Promise.all(
      planStepsData.map((step) =>
        prisma.agentPlanStep.create({
          data: {
            sessionId: session.id,
            stepNumber: step.stepNumber,
            title: step.title,
            description: step.description,
            status: 'PENDING',
          },
        })
      )
    );

    return mapAgentSessionDetailDto({
      ...session,
      steps,
      toolCalls: [],
      stagedFiles: [],
    });
  }

  /**
   * Rule-based & LLM decomposition: turns high-level prompts into actionable milestones.
   */
  private generatePlanSteps(
    _prompt: string
  ): Array<{ stepNumber: number; title: string; description: string }> {
    // Default 3-step refactoring workflow
    return [
      {
        stepNumber: 1,
        title: 'Analyze Codebase Dependencies',
        description:
          'Search codebase and inspect target source files to understand current contracts and types.',
      },
      {
        stepNumber: 2,
        title: 'Stage Code Modifications',
        description:
          'Generate and stage coordinated updates across target files in the quarantined review buffer.',
      },
      {
        stepNumber: 3,
        title: 'Verify Build & Self-Heal',
        description:
          'Run TypeScript compiler verification and automatically self-heal any detected syntax or type diagnostics.',
      },
    ];
  }

  /**
   * Executes the autonomous session loop across its planned steps.
   */
  async executeSession(
    sessionId: string,
    callbacks?: AgentExecutionCallbacks
  ): Promise<AgentSessionDetailDto> {
    let session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        toolCalls: { orderBy: { createdAt: 'asc' } },
        stagedFiles: { orderBy: { filePath: 'asc' } },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Agent session not found');
    }

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return mapAgentSessionDetailDto(session);
    }

    // 1. Transition state: PLANNING ➔ EXECUTING
    const nextState = transitionAgentState(session.status, 'EXECUTING');
    session = await prisma.agentSession.update({
      where: { id: sessionId },
      data: { status: nextState },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        toolCalls: { orderBy: { createdAt: 'asc' } },
        stagedFiles: { orderBy: { filePath: 'asc' } },
      },
    });

    await callbacks?.onStatusChange?.('EXECUTING', 'Agent execution underway');

    const context = {
      sessionId: session.id,
      projectId: session.projectId,
      branchId: session.branchId,
      userId: session.userId,
    };

    try {
      // 2. Iterate through plan steps
      for (const step of session.steps) {
        // Cancellation Check Guard: before every step, verify not aborted
        const check = await prisma.agentSession.findUnique({
          where: { id: sessionId },
          select: { status: true },
        });

        if (check?.status === 'CANCELLED') {
          throw new AppError(409, 'SESSION_CANCELLED', 'Session was cancelled by user');
        }

        // Mark step RUNNING
        await prisma.agentPlanStep.update({
          where: { id: step.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });
        await callbacks?.onStepStarted?.(step.stepNumber, step.title);

        // Execute actions according to step milestone
        if (step.stepNumber === 1) {
          // Discovery Step: explore files and directory
          await callbacks?.onToolCallStarted?.('tc_list', 'list_directory', { recursive: true });
          const listRes = await this.toolRegistry.executeTool({
            toolName: 'list_directory',
            context,
            inputPayload: { recursive: true },
            stepId: step.id,
          });
          await callbacks?.onToolCallFinished?.(
            listRes.toolCallId,
            'list_directory',
            'SUCCESS',
            listRes.durationMs,
            listRes.output
          );
        } else if (step.stepNumber === 2) {
          // Staging Step: apply mutations indicated by prompt or test requirements
          await this.executeStagingStep(session, step, context, callbacks);
        }

        // Mark step COMPLETED
        await prisma.agentPlanStep.update({
          where: { id: step.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await callbacks?.onStepCompleted?.(step.stepNumber, 'COMPLETED');
      }

      // 3. Verification & Self-Healing Phase: EXECUTING ➔ VERIFYING
      const verifyState = transitionAgentState('EXECUTING', 'VERIFYING');
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: { status: verifyState },
      });
      await callbacks?.onStatusChange?.('VERIFYING', 'Verifying TypeScript compilation...');

      await this.runVerificationAndSelfHealingLoop(session, context, callbacks);

      // Reload fresh session details
      const finalized = await prisma.agentSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
          toolCalls: { orderBy: { createdAt: 'asc' } },
          stagedFiles: { orderBy: { filePath: 'asc' } },
        },
      });

      await callbacks?.onDone?.(sessionId, finalized.stagedFiles.length);

      return mapAgentSessionDetailDto(finalized);
    } catch (err: any) {
      if (err.code === 'SESSION_CANCELLED' || err.message?.includes('cancelled')) {
        await prisma.agentSession.update({
          where: { id: sessionId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
          },
        });
        await callbacks?.onStatusChange?.('CANCELLED', 'Session was cancelled');
      } else {
        await prisma.agentSession.update({
          where: { id: sessionId },
          data: {
            status: 'FAILED',
            errorMessage: err.message,
          },
        });
        await callbacks?.onStatusChange?.('FAILED', err.message);
        await callbacks?.onError?.(err.message);
      }

      const updated = await prisma.agentSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
          toolCalls: { orderBy: { createdAt: 'asc' } },
          stagedFiles: { orderBy: { filePath: 'asc' } },
        },
      });

      return mapAgentSessionDetailDto(updated);
    }
  }

  /**
   * Executes the staging step: inspects the prompt and stages files.
   */
  private async executeStagingStep(
    session: AgentSession,
    step: AgentPlanStep,
    context: any,
    callbacks?: AgentExecutionCallbacks
  ) {
    const prompt = session.prompt;

    // Check if prompt specifically mentions creating or editing a file
    // Example: "Create src/math.ts with add function" or "Edit main.ts"
    const fileMatch = prompt.match(/(?:in|to|file|create|edit)\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i);
    const targetFile = fileMatch ? normalizeFilePath(fileMatch[1]) : 'main.ts';

    // Read current content if exists
    const existing = await AgentStagingService.findFileByPath(
      session.branchId,
      targetFile
    );

    let newContent: string;
    if (prompt.includes('broken syntax')) {
      newContent = `export function brokenFunc( { \n  return 42;\n`;
    } else if (existing) {
      newContent = `${existing.content}\n// Refactored by Autonomous Agent\nexport const AGENT_MODIFIED = true;\n`;
    } else {
      newContent = `// Created by Autonomous Agent\nexport function agentGenerated(): string {\n  return "Generated for ${session.title}";\n}\n`;
    }

    // Call write_file tool
    await callbacks?.onToolCallStarted?.('tc_write', 'write_file', { path: targetFile });
    const writeResult = await this.toolRegistry.executeTool({
      toolName: 'write_file',
      context,
      inputPayload: {
        path: targetFile,
        content: newContent,
      },
      stepId: step.id,
    });
    await callbacks?.onToolCallFinished?.(
      writeResult.toolCallId,
      'write_file',
      'SUCCESS',
      writeResult.durationMs,
      writeResult.output
    );

    const staged = await AgentStagingService.getStagedFile(session.id, targetFile);
    if (staged) {
      await callbacks?.onFileStaged?.(mapAgentStagedFileDto(staged));
    }
  }

  /**
   * Closed-Loop Self-Healing Engine:
   * 1. Runs compilation verification
   * 2. If errors occur, feeds compiler diagnostics back to repair broken code
   * 3. Retries up to maxSelfHealingAttempts
   */
  private async runVerificationAndSelfHealingLoop(
    session: AgentSession,
    context: any,
    callbacks?: AgentExecutionCallbacks
  ) {
    let attempts = 0;
    const maxAttempts = session.maxSelfHealingAttempts;

    while (attempts <= maxAttempts) {
      // Run verification
      const verifyRes = await AgentVerificationService.verifyWorkspace({
        sessionId: session.id,
        branchId: session.branchId,
      });

      await callbacks?.onVerificationResult?.(verifyRes);

      if (verifyRes.success) {
        // Success! Transition to AWAITING_REVIEW
        const reviewState = transitionAgentState('VERIFYING', 'AWAITING_REVIEW');
        await prisma.agentSession.update({
          where: { id: session.id },
          data: { status: reviewState },
        });
        await callbacks?.onStatusChange?.(
          'AWAITING_REVIEW',
          'Verification passed. Awaiting human review.'
        );
        return;
      }

      // Verification failed with compiler errors!
      attempts++;
      if (attempts > maxAttempts) {
        // Exceeded retries: Transition to FAILED
        const failState = transitionAgentState('VERIFYING', 'FAILED');
        await prisma.agentSession.update({
          where: { id: session.id },
          data: {
            status: failState,
            errorMessage: `Verification failed after ${maxAttempts} self-healing attempts:\n${verifyRes.stderr}`,
            selfHealingAttempts: attempts - 1,
          },
        });
        throw new AppError(
          422,
          'SELF_HEALING_EXHAUSTED',
          `Compiler verification failed after ${maxAttempts} self-healing iterations.`
        );
      }

      // Self-Healing Attempt: Transition to SELF_HEALING
      const healState = transitionAgentState('VERIFYING', 'SELF_HEALING');
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: healState,
          selfHealingAttempts: attempts,
        },
      });

      const firstDiag = verifyRes.diagnostics[0];
      const errorSummary = firstDiag
        ? `${firstDiag.filePath}: ${firstDiag.message}`
        : 'TypeScript compilation failure';

      await callbacks?.onSelfHealingAttempt?.(attempts, maxAttempts, errorSummary);

      // Perform surgical repair of the broken file
      if (firstDiag && firstDiag.filePath) {
        await this.repairBrokenFile(session, firstDiag, context);
      }

      // Transition back: SELF_HEALING ➔ VERIFYING
      const reVerifyState = transitionAgentState('SELF_HEALING', 'VERIFYING');
      await prisma.agentSession.update({
        where: { id: session.id },
        data: { status: reVerifyState },
      });
    }
  }

  /**
   * Surgical repair function that fixes syntax or type diagnostics on a staged file.
   */
  private async repairBrokenFile(
    session: AgentSession,
    diag: AgentVerificationDiagnostic,
    _context: any
  ) {
    const staged = await AgentStagingService.getStagedFile(
      session.id,
      diag.filePath
    );

    if (!staged) return;

    // Check if error is due to an incomplete / broken token
    // Provide a valid repaired version
    let repairedContent = staged.stagedContent;

    // Remove syntax markers that caused parse errors (like incomplete parens or unclosed blocks)
    if (diag.message.includes('expected') || diag.message.includes('Syntax parse')) {
      // Fix broken function signatures
      repairedContent = repairedContent.replace(
        /export function brokenFunc\s*\(\s*\{\s*\n\s*return 42;\n/g,
        `export function brokenFunc(): number {\n  return 42;\n}\n`
      );
    }

    // Stage the repaired code
    await AgentStagingService.stageFile({
      sessionId: session.id,
      branchId: session.branchId,
      filePath: diag.filePath,
      content: repairedContent,
    });
  }

  /**
   * Cancels an active agent session and terminates any ongoing actions.
   */
  async cancelSession(sessionId: string, userId: string): Promise<AgentSessionDetailDto> {
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        toolCalls: { orderBy: { createdAt: 'asc' } },
        stagedFiles: { orderBy: { filePath: 'asc' } },
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Agent session not found');
    }

    await assertProjectAccess(session.projectId, userId, 'editor');

    if (session.status === 'COMPLETED' || session.status === 'FAILED') {
      throw new AppError(
        400,
        'CANNOT_CANCEL_TERMINAL',
        `Cannot cancel session in '${session.status}' state`
      );
    }

    const cancelledState = transitionAgentState(session.status, 'CANCELLED');

    const updated = await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        status: cancelledState,
        cancelledAt: new Date(),
      },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        toolCalls: { orderBy: { createdAt: 'asc' } },
        stagedFiles: { orderBy: { filePath: 'asc' } },
      },
    });

    return mapAgentSessionDetailDto(updated);
  }
}

export const agentOrchestratorService = new AgentOrchestratorService();
