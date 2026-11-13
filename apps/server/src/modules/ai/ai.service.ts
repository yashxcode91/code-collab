import { Response } from 'express';
import {
  AiActionKind as DbAiActionKind,
  AiMessageRole as DbAiMessageRole,
  prisma,
} from '@codecollab/database';
import {
  AI_LIMITS,
  AiActionKind,
  AiConversationDetailDto,
  AiConversationSummaryDto,
  AiMessageDto,
  AiMessageRole,
  AiPromptContext,
  AiPromptRequest,
  AiStreamChunkDto,
  buildFileRoomKey,
} from '@codecollab/shared';
import { yjsRoomManager } from '../../realtime/yjsRoomManager';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertFileInBranch,
  assertProjectAccess,
  assertValidUuid,
} from '../projects/project.auth';
import { resolveInheritedOverride } from '../projects/project.service';
import {
  AiCompletionResult,
  AiPromptPayload,
  getAiProvider,
} from './ai.provider';

// =====================================================================
// Enum Mappers & DTO Serializers
// =====================================================================

export const toDtoMessageRole = (role: DbAiMessageRole): AiMessageRole => {
  switch (role) {
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    case 'SYSTEM':
      return 'system';
  }
};

export const toDbMessageRole = (role: AiMessageRole): DbAiMessageRole => {
  switch (role) {
    case 'user':
      return 'USER';
    case 'assistant':
      return 'ASSISTANT';
    case 'system':
      return 'SYSTEM';
  }
};

export const toDtoActionKind = (kind: DbAiActionKind): AiActionKind => {
  switch (kind) {
    case 'CHAT':
      return 'chat';
    case 'EXPLAIN':
      return 'explain';
    case 'DEBUG':
      return 'debug';
    case 'GENERATE_TESTS':
      return 'generate_tests';
    case 'REVIEW':
      return 'review';
    case 'REFACTOR':
      return 'refactor';
  }
};

export const toDbActionKind = (kind: AiActionKind): DbAiActionKind => {
  switch (kind) {
    case 'chat':
      return 'CHAT';
    case 'explain':
      return 'EXPLAIN';
    case 'debug':
      return 'DEBUG';
    case 'generate_tests':
      return 'GENERATE_TESTS';
    case 'review':
      return 'REVIEW';
    case 'refactor':
      return 'REFACTOR';
  }
};

export const mapAiMessageDto = (row: {
  id: string;
  conversationId: string;
  role: DbAiMessageRole;
  actionKind: DbAiActionKind;
  content: string;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  fileId: string | null;
  fileName: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  suggestedCode: string | null;
  createdAt: Date;
}): AiMessageDto => ({
  id: row.id,
  conversationId: row.conversationId,
  role: toDtoMessageRole(row.role),
  actionKind: toDtoActionKind(row.actionKind),
  content: row.content,
  model: row.model,
  promptTokens: row.promptTokens,
  completionTokens: row.completionTokens,
  codeContext:
    row.fileId || row.fileName
      ? {
          ...(row.fileId ? { fileId: row.fileId } : {}),
          ...(row.fileName ? { fileName: row.fileName } : {}),
          ...(row.lineStart !== null ? { lineStart: row.lineStart } : {}),
          ...(row.lineEnd !== null ? { lineEnd: row.lineEnd } : {}),
        }
      : null,
  suggestedCode: row.suggestedCode,
  createdAt: row.createdAt.toISOString(),
});

export const mapAiConversationSummaryDto = (row: {
  id: string;
  projectId: string;
  branchId: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { messages: number };
  messages?: Array<{ createdAt: Date }>;
}): AiConversationSummaryDto => ({
  id: row.id,
  projectId: row.projectId,
  branchId: row.branchId,
  userId: row.userId,
  title: row.title,
  messageCount: row._count?.messages ?? 0,
  lastMessageAt:
    row.messages && row.messages[0]
      ? row.messages[0].createdAt.toISOString()
      : row.updatedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// =====================================================================
// Context Assembler & ACL Protection
// =====================================================================

export interface AssembledContextResult {
  branchName: string;
  activeFilePath?: string;
  activeFileContent?: string;
  selectedCode?: string;
  selectionRange?: { startLine: number; endLine: number };
  terminalError?: string;
}

/**
 * Validates branch access, inspects per-file ACL overrides (denies access if caller
 * is DENIED on the target file), flushes any unsaved Yjs editor strokes to PostgreSQL,
 * extracts selected code lines, and captures recent execution errors.
 */
export const assembleAiContext = async (
  projectId: string,
  branchId: string,
  userId: string,
  context?: AiPromptContext
): Promise<AssembledContextResult> => {
  const { role } = await assertProjectAccess(projectId, userId);
  const branch = await assertBranchInProject(projectId, branchId);

  const result: AssembledContextResult = {
    branchName: branch.name,
  };

  // 1. If an active file is targeted, enforce ACL isolation
  if (context?.fileId) {
    assertValidUuid(context.fileId, 'File');
    const file = await assertFileInBranch(branch.id, context.fileId, userId);

    if (file.nodeType === 'FOLDER') {
      throw new AppError(400, 'INVALID_FILE_NODE', 'Cannot attach a folder as AI file context');
    }

    // Verify per-file ACL hierarchy: non-owners with 'denied' access cannot inspect this file
    const override = await resolveInheritedOverride(branch.id, file.id, userId);
    if (role !== 'owner' && override === 'denied') {
      throw new AppError(
        403,
        'FILE_ACCESS_DENIED',
        'You do not have access to this file'
      );
    }

    // Flush any live in-memory Yjs strokes so AI inspects the freshest editor content
    try {
      await yjsRoomManager.flushRoom(buildFileRoomKey(branch.id, file.id));
    } catch {
      // Yjs room may not be active; fall back to persisted database content
    }

    const latestFile = await prisma.projectFile.findUnique({
      where: { id: file.id },
      select: { content: true, name: true },
    });

    const fullContent = latestFile?.content ?? file.content;
    result.activeFilePath = file.name;

    // Enforce max file context size (100 KB) to prevent runaway token usage
    const safeContent =
      fullContent.length > AI_LIMITS.MAX_CONTEXT_FILE_BYTES
        ? fullContent.slice(0, AI_LIMITS.MAX_CONTEXT_FILE_BYTES) + '\n/* ...[truncated for context limits]... */'
        : fullContent;

    result.activeFileContent = safeContent;

    // 2. Extract selected lines or text range if provided
    if (context.selection) {
      const { startLine, endLine, text } = context.selection;
      if (text && text.trim().length > 0) {
        result.selectedCode = text;
        result.selectionRange = { startLine, endLine };
      } else if (startLine > 0 && endLine >= startLine) {
        const lines = fullContent.split('\n');
        const startIdx = Math.max(0, startLine - 1);
        const endIdx = Math.min(lines.length, endLine);
        result.selectedCode = lines.slice(startIdx, endIdx).join('\n');
        result.selectionRange = { startLine, endLine };
      }
    }
  }

  // 3. Attach terminal execution error if referenced
  if (context?.executionRunId) {
    assertValidUuid(context.executionRunId, 'Execution Run');
    const run = await prisma.executionRun.findUnique({
      where: { id: context.executionRunId },
      select: {
        id: true,
        projectId: true,
        branchId: true,
        status: true,
        errorMessage: true,
        stderr: true,
        exitCode: true,
      },
    });

    if (run && run.projectId === projectId && run.branchId === branchId) {
      if (run.status === 'FAILED' || run.errorMessage || run.stderr || (run.exitCode !== null && run.exitCode !== 0)) {
        result.terminalError =
          run.errorMessage ||
          run.stderr ||
          `Process exited with non-zero status code: ${run.exitCode}`;
      }
    }
  } else if (context?.terminalError && context.terminalError.trim().length > 0) {
    result.terminalError = context.terminalError.trim().slice(0, 4000);
  }

  return result;
};

// =====================================================================
// Conversation Lifecycle Management
// =====================================================================

export const createOrGetAiConversation = async (
  projectId: string,
  branchId: string,
  userId: string,
  conversationId?: string,
  promptPreview?: string
) => {
  if (conversationId) {
    assertValidUuid(conversationId, 'Conversation');
    const existing = await prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });

    if (!existing || existing.projectId !== projectId || existing.branchId !== branchId) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'AI Conversation not found on this branch');
    }

    if (existing.userId !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
    }

    return existing;
  }

  // Generate a clean conversation title from the prompt
  const title = promptPreview
    ? promptPreview.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 45) || 'New Conversation'
    : 'New Conversation';

  return prisma.aiConversation.create({
    data: {
      projectId,
      branchId,
      userId,
      title,
    },
  });
};

export const listAiConversations = async (
  projectId: string,
  branchId: string,
  userId: string
): Promise<AiConversationSummaryDto[]> => {
  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  await assertProjectAccess(projectId, userId);
  await assertBranchInProject(projectId, branchId);

  const rows = await prisma.aiConversation.findMany({
    where: {
      projectId,
      branchId,
      userId,
    },
    orderBy: { updatedAt: 'desc' },
    take: AI_LIMITS.MAX_PAGE_SIZE,
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return rows.map(mapAiConversationSummaryDto);
};

export const getAiConversationDetail = async (
  projectId: string,
  branchId: string,
  conversationId: string,
  userId: string
): Promise<AiConversationDetailDto> => {
  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(conversationId, 'Conversation');

  await assertProjectAccess(projectId, userId);
  await assertBranchInProject(projectId, branchId);

  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: {
      _count: {
        select: { messages: true },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: AI_LIMITS.MAX_MESSAGES_PER_CONVERSATION,
      },
    },
  });

  if (!conversation || conversation.projectId !== projectId || conversation.branchId !== branchId) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'AI Conversation not found');
  }

  if (conversation.userId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this conversation');
  }

  return {
    conversation: mapAiConversationSummaryDto(conversation),
    messages: conversation.messages.map(mapAiMessageDto),
  };
};

export const deleteAiConversation = async (
  projectId: string,
  branchId: string,
  conversationId: string,
  userId: string
): Promise<void> => {
  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');
  assertValidUuid(conversationId, 'Conversation');

  await assertProjectAccess(projectId, userId);
  await assertBranchInProject(projectId, branchId);

  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || conversation.projectId !== projectId || conversation.branchId !== branchId) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'AI Conversation not found');
  }

  if (conversation.userId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to delete this conversation');
  }

  await prisma.aiConversation.delete({
    where: { id: conversationId },
  });
};

// =====================================================================
// Real-Time SSE Stream Orchestration
// =====================================================================

export const writeSseChunk = (res: Response, chunk: AiStreamChunkDto): void => {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
};

export interface StreamAiPromptParams {
  projectId: string;
  branchId: string;
  userId: string;
  input: AiPromptRequest;
  res: Response;
  signal?: AbortSignal;
}

/**
 * Handles the complete lifecycle of an AI prompt over Server-Sent Events (SSE):
 * 1. Checks permissions & per-file ACLs
 * 2. Prepares SSE transport headers
 * 3. Persists the user message
 * 4. Dispatches to the active AI provider adapter (offline mock or Gemini/OpenAI)
 * 5. Streams token deltas in real-time
 * 6. Persists the assistant message & emits 'done'
 */
export const streamAiPrompt = async (params: StreamAiPromptParams): Promise<void> => {
  const { projectId, branchId, userId, input, res, signal } = params;

  assertValidUuid(projectId, 'Project');
  assertValidUuid(branchId, 'Branch');

  // Verify access and assemble context BEFORE setting SSE headers so standard HTTP errors (403/404) work
  const assembledContext = await assembleAiContext(
    projectId,
    branchId,
    userId,
    input.context
  );

  const conversation = await createOrGetAiConversation(
    projectId,
    branchId,
    userId,
    input.conversationId,
    input.prompt
  );

  // Set SSE transport headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const provider = getAiProvider();

  // 1. Emit start frame
  writeSseChunk(res, {
    type: 'start',
    conversationId: conversation.id,
    messageId: 'pending',
    model: provider.name,
    actionKind: input.actionKind,
  });

  try {
    // 2. Persist the USER's prompt message
    await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        actionKind: toDbActionKind(input.actionKind),
        content: input.prompt,
        fileId: input.context?.fileId ?? null,
        fileName: assembledContext.activeFilePath ?? null,
        lineStart: assembledContext.selectionRange?.startLine ?? null,
        lineEnd: assembledContext.selectionRange?.endLine ?? null,
      },
    });

    // 3. Fetch recent conversation history (last 6 messages) for multi-turn context
    const pastMessages = await prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });

    const history = pastMessages.reverse().map((m) => ({
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    // 4. Stream completion tokens from provider adapter
    const payload: AiPromptPayload = {
      prompt: input.prompt,
      actionKind: input.actionKind,
      ...assembledContext,
      history,
    };

    const result: AiCompletionResult = await provider.streamCompletion(
      payload,
      (token: string) => {
        writeSseChunk(res, { type: 'token', token });
      },
      signal
    );

    // 5. If code patch was detected, emit action frame
    if (result.suggestedCode) {
      writeSseChunk(res, {
        type: 'action',
        actionKind: input.actionKind,
        suggestedCode: result.suggestedCode,
      });
    }

    // 6. Persist the ASSISTANT's completion message
    const assistantMessage = await prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        actionKind: toDbActionKind(input.actionKind),
        content: result.content,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        fileId: input.context?.fileId ?? null,
        fileName: assembledContext.activeFilePath ?? null,
        lineStart: assembledContext.selectionRange?.startLine ?? null,
        lineEnd: assembledContext.selectionRange?.endLine ?? null,
        suggestedCode: result.suggestedCode ?? null,
      },
    });

    // Update conversation timestamp
    await prisma.aiConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    // 7. Emit done frame with persisted message payload
    writeSseChunk(res, {
      type: 'done',
      message: mapAiMessageDto(assistantMessage),
    });

    res.end();
  } catch (err: any) {
    writeSseChunk(res, {
      type: 'error',
      code: err.code || 'AI_STREAM_ERROR',
      message: err.message || 'AI streaming operation failed',
    });
    res.end();
  }
};
