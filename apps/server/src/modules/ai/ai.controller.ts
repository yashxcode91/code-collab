import { Request, Response } from 'express';
import {
  deleteAiConversation,
  getAiConversationDetail,
  listAiConversations,
  streamAiPrompt,
} from './ai.service';

/**
 * Streams real-time AI responses over Server-Sent Events (SSE).
 * Handles client disconnect abort signals cleanly to prevent hanging provider work.
 */
export const streamAiPromptController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const userId = req.user!.id;

  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  await streamAiPrompt({
    projectId,
    branchId,
    userId,
    input: req.body,
    res,
    signal: abortController.signal,
  });
};

/**
 * Lists user AI conversations on a specific branch.
 */
export const listAiConversationsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const userId = req.user!.id;

  const conversations = await listAiConversations(
    projectId,
    branchId,
    userId
  );

  res.json({ conversations });
};

/**
 * Retrieves the full detail and message history of an AI conversation.
 */
export const getAiConversationDetailController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, conversationId } = req.params as {
    projectId: string;
    branchId: string;
    conversationId: string;
  };
  const userId = req.user!.id;

  const detail = await getAiConversationDetail(
    projectId,
    branchId,
    conversationId,
    userId
  );

  res.json(detail);
};

/**
 * Deletes an AI conversation and its message turns.
 */
export const deleteAiConversationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { projectId, branchId, conversationId } = req.params as {
    projectId: string;
    branchId: string;
    conversationId: string;
  };
  const userId = req.user!.id;

  await deleteAiConversation(
    projectId,
    branchId,
    conversationId,
    userId
  );

  res.status(204).send();
};
