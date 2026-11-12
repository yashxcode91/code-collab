import { Request, Response } from 'express';
import {
  ChatHistoryQuerySchema,
  type CreateChatMessageInput,
} from '@codecollab/shared';
import { broadcastChatMessage } from '../../realtime/socketServer';
import {
  createProjectChatMessage,
  listProjectChatMessages,
} from './chat.service';

export const listProjectChatMessagesController = async (
  req: Request,
  res: Response
) => {
  const { projectId } = req.params as { projectId: string };
  const query = ChatHistoryQuerySchema.parse(req.query);

  const result = await listProjectChatMessages({
    projectId,
    userId: req.user!.id,
    cursor: query.cursor,
    limit: query.limit,
  });

  res.json({
    success: true,
    data: result,
  });
};

export const createProjectChatMessageController = async (
  req: Request,
  res: Response
) => {
  const { projectId } = req.params as { projectId: string };
  const input = req.body as CreateChatMessageInput;

  const message = await createProjectChatMessage({
    projectId,
    userId: req.user!.id,
    input,
  });

  broadcastChatMessage(message);

  res.status(201).json({
    success: true,
    data: { message },
  });
};
