import { Request, Response } from 'express';
import { prisma } from '@codecollab/database';
import {
  AgentStreamEventDto,
  ApplyStagedFilesInput,
  CreateAgentSessionInput,
  DiscardStagedFilesInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertProjectAccess,
  assertValidUuid,
} from '../projects/project.auth';
import {
  agentOrchestratorService,
  mapAgentSessionDetailDto,
} from './agentOrchestrator.service';
import { AgentStagingService } from './agentStaging.service';

export const writeAgentSseEvent = (
  res: Response,
  event: AgentStreamEventDto
): void => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
};

/**
 * POST /api/projects/:projectId/branches/:branchId/agent/sessions
 * Creates an autonomous agent refactoring session and initial plan.
 */
export const createAgentSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const userId = req.user!.id;
  const body = req.body as CreateAgentSessionInput;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');

  const session = await agentOrchestratorService.createSession({
    projectId,
    branchId,
    userId,
    prompt: body.prompt,
    title: body.title,
    model: body.model,
  });

  res.status(201).json({
    success: true,
    data: session,
  });
};

/**
 * GET /api/projects/:projectId/branches/:branchId/agent/sessions/:sessionId
 * Retrieves the current state, plan steps, tool calls, and staged files.
 */
export const getAgentSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, sessionId } = req.params as {
    projectId: string;
    branchId: string;
    sessionId: string;
  };
  const userId = req.user!.id;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(sessionId, 'Agent Session');

  await assertProjectAccess(projectId, userId);
  await assertBranchInProject(projectId, branchId);

  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    include: {
      steps: { orderBy: { stepNumber: 'asc' } },
      toolCalls: { orderBy: { createdAt: 'asc' } },
      stagedFiles: { orderBy: { filePath: 'asc' } },
    },
  });

  if (!session || session.projectId !== projectId || session.branchId !== branchId) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Agent session not found');
  }

  res.status(200).json({
    success: true,
    data: mapAgentSessionDetailDto(session as any),
  });
};

/**
 * POST /api/projects/:projectId/branches/:branchId/agent/sessions/:sessionId/stream
 * Server-Sent Events (SSE) endpoint streaming execution progress, reasoning,
 * tool calls, and self-healing iterations in real-time.
 */
export const streamAgentSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, sessionId } = req.params as {
    projectId: string;
    branchId: string;
    sessionId: string;
  };
  const userId = req.user!.id;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(sessionId, 'Agent Session');

  await assertProjectAccess(projectId, userId, 'editor');
  await assertBranchInProject(projectId, branchId);

  // Set SSE wire headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  writeAgentSseEvent(res, {
    type: 'session_status',
    sessionId,
    status: 'EXECUTING',
    message: 'Initializing agent execution...',
  });

  try {
    await agentOrchestratorService.executeSession(sessionId, {
      onStatusChange: (status, message) => {
        writeAgentSseEvent(res, {
          type: 'session_status',
          sessionId,
          status: status as any,
          message,
        });
      },
      onPlanCreated: (steps) => {
        writeAgentSseEvent(res, {
          type: 'plan_created',
          sessionId,
          steps,
        });
      },
      onStepStarted: (stepNumber, title) => {
        writeAgentSseEvent(res, {
          type: 'step_started',
          sessionId,
          stepNumber,
          title,
        });
      },
      onStepCompleted: (stepNumber, status, errorMessage) => {
        writeAgentSseEvent(res, {
          type: 'step_completed',
          sessionId,
          stepNumber,
          status: status as any,
          errorMessage,
        });
      },
      onToolCallStarted: (toolCallId, toolName, input) => {
        writeAgentSseEvent(res, {
          type: 'tool_call_started',
          sessionId,
          toolCallId,
          toolName,
          input,
        });
      },
      onToolCallFinished: (toolCallId, toolName, status, durationMs, output, error) => {
        writeAgentSseEvent(res, {
          type: 'tool_call_finished',
          sessionId,
          toolCallId,
          toolName,
          status: status as any,
          durationMs,
          output,
          error,
        });
      },
      onFileStaged: (file) => {
        writeAgentSseEvent(res, {
          type: 'file_staged',
          sessionId,
          file,
        });
      },
      onSelfHealingAttempt: (attempt, maxAttempts, errorSummary) => {
        writeAgentSseEvent(res, {
          type: 'self_healing_attempt',
          sessionId,
          attempt,
          maxAttempts,
          errorSummary,
        });
      },
      onVerificationResult: (result) => {
        writeAgentSseEvent(res, {
          type: 'verification_result',
          sessionId,
          result,
        });
      },
      onDone: (sId, totalFilesStaged) => {
        writeAgentSseEvent(res, {
          type: 'done',
          sessionId: sId,
          status: 'AWAITING_REVIEW',
          totalFilesStaged,
        });
      },
      onError: (message) => {
        writeAgentSseEvent(res, {
          type: 'error',
          sessionId,
          message,
        });
      },
    });

    res.end();
  } catch (err: any) {
    writeAgentSseEvent(res, {
      type: 'error',
      sessionId,
      message: err.message || 'Agent execution encountered an unrecoverable failure',
    });
    res.end();
  }
};

/**
 * POST /api/projects/:projectId/branches/:branchId/agent/sessions/:sessionId/apply
 * Atomically commits staged files to the branch using Optimistic Concurrency Control.
 */
export const applyStagedFilesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, sessionId } = req.params as {
    projectId: string;
    branchId: string;
    sessionId: string;
  };
  const userId = req.user!.id;
  const body = req.body as ApplyStagedFilesInput;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(sessionId, 'Agent Session');

  await assertProjectAccess(projectId, userId, 'editor');
  await assertBranchInProject(projectId, branchId);

  const result = await AgentStagingService.applyStagedFiles({
    sessionId,
    userId,
    filePaths: body.filePaths,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
};

/**
 * DELETE /api/projects/:projectId/branches/:branchId/agent/sessions/:sessionId/staged
 * Discards uncommitted staged files for the session.
 */
export const discardStagedFilesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, sessionId } = req.params as {
    projectId: string;
    branchId: string;
    sessionId: string;
  };
  const userId = req.user!.id;
  const body = req.body as DiscardStagedFilesInput;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(sessionId, 'Agent Session');

  await assertProjectAccess(projectId, userId, 'editor');
  await assertBranchInProject(projectId, branchId);

  const result = await AgentStagingService.discardStagedFiles({
    sessionId,
    filePaths: body.filePaths,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
};

/**
 * POST /api/projects/:projectId/branches/:branchId/agent/sessions/:sessionId/cancel
 * Cancels an ongoing agent session and halts future turns.
 */
export const cancelAgentSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, sessionId } = req.params as {
    projectId: string;
    branchId: string;
    sessionId: string;
  };
  const userId = req.user!.id;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(sessionId, 'Agent Session');

  const cancelled = await agentOrchestratorService.cancelSession(sessionId, userId);

  res.status(200).json({
    success: true,
    data: cancelled,
  });
};
